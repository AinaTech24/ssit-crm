import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/public/risk-profile/pdf?token=<tokenId>&download=1
 *
 * No-auth route: the single-use share token is the bearer credential. Lets the
 * client download their own completed Risk Profile (Q&A) PDF right after they
 * submit. The token already identifies the subject + tenant, so a caller can
 * only ever fetch the profile the token points at (no IDOR by id-guessing).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens } from "@/db/schema";
import { renderRiskProfilePdf } from "@/lib/risk-profile/risk-profile-pdf";
import { loadActiveTemplate } from "@/lib/risk-profile/template";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const limited = enforce(req, "public.risk-profile.pdf", { limit: 60, windowSec: 60 * 60 });
    if (limited) return limited;

    const tokenId = req.nextUrl.searchParams.get("token") ?? "";
    const download = req.nextUrl.searchParams.get("download") === "1";
    if (!tokenId) return NextResponse.json({ error: "missing token" }, { status: 400 });

    // Resolve the token cross-tenant (no session). usedAt/expiresAt are NOT
    // enforced here — the client downloads after submitting (token already
    // used), and re-downloads should keep working while the token exists.
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t || t.revokedAt || t.kind !== "risk_profile") return null;
      return t;
    });
    if (!tk || !tk.tenantId || !tk.subjectId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const built = await withTenant(tk.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, final_category, total_score, responses, profile_date, age,
               signed_at, signed_by_name, next_review_at, verification_method
        FROM risk_profile_responses
        WHERE investor_id = ${tk.subjectId}::uuid AND tenant_id = ${tk.tenantId}::uuid
        ORDER BY signed_at DESC NULLS LAST
        LIMIT 1
      `);
      const row = r.rows[0] as any;
      if (!row) return null;

      // Subject name/PAN — the response table stores the subject id in
      // investor_id polymorphically (works for a lead too).
      let name: string | null = "Client";
      let pan: string | null = null;
      if (tk.subjectType === "investor") {
        const s = (await tx.execute(
          sql`SELECT name, pan FROM investors WHERE id = ${tk.subjectId}::uuid LIMIT 1`
        )).rows[0] as any;
        name = s?.name ?? "Client";
        pan = s?.pan ?? null;
      } else {
        const s = (await tx.execute(
          sql`SELECT name FROM leads WHERE id = ${tk.subjectId}::uuid LIMIT 1`
        )).rows[0] as any;
        name = s?.name ?? "Client";
      }

      const t = (
        await tx.execute(sql`
          SELECT display_name, legal_name, arn, principal_euin, gst_number,
                 primary_color, secondary_color, logo_url, phone, email, website
          FROM tenants WHERE id = ${tk.tenantId}::uuid LIMIT 1
        `)
      ).rows[0] as any;

      // Template max score gives the number a scale ("24 / 40" on the PDF).
      const tpl = await loadActiveTemplate(tx, tk.tenantId!).catch(() => null);
      const maxScore = tpl
        ? tpl.questions.reduce((s, q) => s + Math.max(...q.options.map((o) => o.score)), 0)
        : null;

      const pdf = await renderRiskProfilePdf({
        profile: {
          category: row.final_category ?? null,
          totalScore: row.total_score != null ? Number(row.total_score) : null,
          maxScore,
          profileDate: row.profile_date ?? null,
          signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
          signedByName: row.signed_by_name ?? null,
          nextReviewAt: row.next_review_at ?? null,
          age: row.age != null ? Number(row.age) : null,
          verificationMethod: row.verification_method ?? null,
          responses: Array.isArray(row.responses) ? row.responses : [],
        },
        investor: { name, pan },
        brand: {
          displayName: t?.display_name,
          legalName: t?.legal_name,
          arn: t?.arn,
          euin: t?.principal_euin,
          gstNumber: t?.gst_number,
          primaryColor: t?.primary_color,
          secondaryColor: t?.secondary_color,
          logoUrl: t?.logo_url,
          phone: t?.phone,
          email: t?.email,
          website: t?.website,
        },
        generatedAt: new Date().toISOString(),
        refId: row.id ?? null,
      });
      return { pdf, name };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    const safe = String(built.name).replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    const disposition = download ? "attachment" : "inline";
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="RiskProfile_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
