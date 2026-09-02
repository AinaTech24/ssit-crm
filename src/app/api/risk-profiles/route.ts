import { handleApiError } from "@/lib/api/error-handler";
/**
 * Risk profile responses collection.
 *
 *   GET  /api/risk-profiles                 — list all latest profiles per investor
 *   POST /api/risk-profiles                 — save a new questionnaire
 *
 * Saving also mirrors `finalCategory` + `signedAt` to the investor row so
 * sidebars, filter builders, and dashboards can read the current state
 * without joining this table.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { riskProfileResponses, investors, eventsOutbox, publicEmailOtps } from "@/db/schema";
import { loadActiveTemplate, scoreAnswersAgainst } from "@/lib/risk-profile/template";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  // Tolerate null (a NaN age serializes to null) and coerce numeric strings —
  // then treat anything outside 1–120 as "no age".
  age: z.coerce.number().int().min(1).max(120).nullish(),
  answers: z.record(z.string(), z.string()), // { questionKey → answerValue }
  documentUrl: z.string().optional(),
  signedByName: z.string().optional(),
  // How the client signed off. Defaults to otp so existing callers keep the
  // previous (OTP-mandatory) behaviour.
  signOffMethod: z.enum(["otp", "signature"]).default("otp"),
  rmRemarks: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    // Risk profiles carry client PII (name, PAN, category). Require an investor
    // view capability (this GET was previously open to ANY authenticated role —
    // marketing included) and scope RMs to their own clients.
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      // Non-managers only see profiles for clients assigned to them.
      const scope = canViewAll ? sql`TRUE` : sql`i.rm_id = ${session.userId}::uuid`;
      // One row per investor — latest signed profile
      const r = await tx.execute(sql`
        SELECT DISTINCT ON (rp.investor_id)
          rp.id, rp.investor_id, rp.profile_date, rp.final_category, rp.total_score,
          rp.signed_at, rp.next_review_at, rp.rm_remarks, rp.document_url,
          i.name AS investor_name, i.pan AS investor_pan
        FROM risk_profile_responses rp
        LEFT JOIN investors i ON i.id = rp.investor_id
        WHERE ${scope}
        ORDER BY rp.investor_id, rp.signed_at DESC NULLS LAST
      `);
      return r.rows;
    });
    return NextResponse.json({ profiles: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const now = new Date();
    const profileId = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Load the tenant's active questionnaire (falls back to seed default).
      const template = await loadActiveTemplate(tx, session.tenantId);

      // Every question in the active template must be answered.
      const missing = template.questions.filter((q) => !body.answers[q.key]).map((q) => q.key);
      if (missing.length) {
        throw Object.assign(new Error(`missing answers for: ${missing.join(", ")}`), { status: 400 });
      }

      const { total, band, breakdown } = scoreAnswersAgainst(template, body.answers);

      // Map the matched band back to the investor.riskProfile enum.
      // Tenants can name their bands anything — we use the band.id (lowercased)
      // to map, falling back to "moderate" when the id isn't one of the canonical
      // values. The full band label is stored on the response row for fidelity.
      const canonicalCategory = (
        ["conservative", "moderate", "aggressive", "very_aggressive"].includes(band.id) ? band.id : "moderate"
      ) as "conservative" | "moderate" | "aggressive" | "very_aggressive";

      const reviewDays = template.reviewIntervalDays ?? 365;
      const nextReview = new Date(now);
      nextReview.setDate(nextReview.getDate() + reviewDays);

      const inv = (await tx.select().from(investors).where(eq(investors.id, body.investorId)).limit(1))[0];
      if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });

      // Mandatory client sign-off. Two accepted routes, and the stored
      // `verificationMethod` must describe what ACTUALLY happened — a scanned
      // signature is not OTP-verified, and labelling it `client_otp` would
      // overclaim the strength of the evidence in a SEBI audit.
      //
      //   otp       → email one-time code verified server-side  → client_otp
      //   signature → a signed form was uploaded by the RM      → client_physical
      let verificationMethod: "client_otp" | "client_physical";
      let otpRowId: string | null = null;

      if (body.signOffMethod === "signature") {
        if (!body.documentUrl) {
          throw Object.assign(
            new Error("Upload the signed risk-profile form before submitting."),
            { status: 400 }
          );
        }
        verificationMethod = "client_physical";
      } else {
        // The verified row is consumed below so it can't be reused for a second profile.
        const [otp] = await tx
          .select()
          .from(publicEmailOtps)
          .where(eq(publicEmailOtps.tokenId, body.investorId));
        if (!otp || !otp.verifiedAt) {
          throw Object.assign(
            new Error("Client email is not verified — complete the email OTP step first."),
            { status: 403 }
          );
        }
        verificationMethod = "client_otp";
        otpRowId = otp.id;
      }

      // Insert the response row — historical row is immutable; it carries the
      // resolved band label + score breakdown for SEBI audit.
      await tx.insert(riskProfileResponses).values({
        id: profileId,
        tenantId: session.tenantId,
        investorId: body.investorId,
        profileDate: now.toISOString().slice(0, 10),
        age: body.age ?? null,
        // Legacy column writes — only fill if the tenant happens to use the
        // canonical question keys + enum values. Otherwise, the breakdown
        // jsonb column is the source of truth.
        investmentHorizon: enumOrNull(body.answers.investmentHorizon),
        incomeStability: enumOrNull(body.answers.incomeStability),
        riskCapacity: enumOrNull(body.answers.riskCapacity),
        riskTolerance: enumOrNull(body.answers.riskTolerance),
        investmentObjective: enumOrNull(body.answers.investmentObjective),
        mfExperience: enumOrNull(body.answers.mfExperience),
        netWorthBand: enumOrNull(body.answers.netWorthBand),
        finalCategory: canonicalCategory,
        totalScore: total,
        responses: breakdown,
        documentUrl: body.documentUrl ?? null,
        signedAt: now,
        signedByName: body.signedByName ?? inv.name,
        nextReviewAt: nextReview.toISOString().slice(0, 10),
        rmRemarks: body.rmRemarks ?? null,
        verificationMethod,
        createdById: session.userId,
      } as any);

      // Consume the OTP so it can't be reused for another profile. Only on the
      // OTP path — the signature path never created one.
      if (otpRowId) {
        await tx.delete(publicEmailOtps).where(eq(publicEmailOtps.tokenId, body.investorId));
      }

      await tx
        .update(investors)
        .set({
          riskProfile: canonicalCategory as any,
          riskProfileScore: total,
          riskProfileSignedAt: now,
          riskProfileVersion: ((inv.riskProfileVersion ?? 0) + 1) as any,
          updatedAt: now,
        } as any)
        .where(eq(investors.id, body.investorId));

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "risk_profile.completed",
        entityType: "investor",
        entityId: body.investorId,
        after: {
          profileId,
          category: canonicalCategory,
          bandLabel: band.label,
          totalScore: total,
          nextReviewAt: nextReview.toISOString(),
        },
        meta: { userId: session.userId, templateVersion: (template as any).versionNumber ?? null } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "risk_profile.complete",
        entityType: "risk_profile_response",
        entityId: profileId,
        after: { investorId: body.investorId, category: canonicalCategory, bandLabel: band.label, totalScore: total } as any,
        ...clientMeta,
      });

      return {
        id: profileId,
        category: canonicalCategory,
        bandLabel: band.label,
        totalScore: total,
        nextReviewAt: nextReview.toISOString().slice(0, 10),
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

// Helper — only writes the legacy enum column if the supplied value is non-empty
// (older callers / preview pages may still use the spec answer slugs).
function enumOrNull(v: string | undefined): any {
  return v && v.length ? (v as any) : null;
}
