import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/convert
 * Body: { pan, segmentTag?, investorCategory?, rmId?, notes? }
 *
 * Converts a qualified lead into an investor:
 *   1. Creates an investor record using lead's name/email/phone/city + PAN supplied
 *   2. Stamps lead.stage = 'converted', converted_at = now(), converted_investor_id = new id
 *   3. Emits 'lead.converted' + 'investor.created' outbox events so subscribed
 *      workflows (welcome onboarding, first-investment plays) fire automatically.
 *
 * Returns { investorId } so the UI can redirect.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance } from "@/lib/blueprints/auto-advance";
import { loadEditableLead } from "@/lib/leads/access";
import { normalizePan } from "@/lib/leads/normalize";
import { mapKycFieldsToInvestorUpdate } from "@/lib/onboarding/kyc-fields";
import {
  leads,
  investors,
  users,
  eventsOutbox,
  riskProfileResponses,
  proposals,
  complianceDocuments,
  communications,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  // PAN is OPTIONAL — it's often captured after KYC docs are received. If
  // provided it must be a valid PAN; blank/omitted converts the lead PAN-less
  // (the owner fills it in later from the client master).
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F")
    .optional()
    .or(z.literal("")),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).default("Retail"),
  investorCategory: z
    .enum(["individual", "huf", "corporate", "trust", "nri", "minor", "other"])
    .default("individual"),
  rmId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const investorId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, leadId);
      if (lead.convertedInvestorId) {
        // Idempotent — return the existing investor
        return { investorId: lead.convertedInvestorId, alreadyConverted: true };
      }

      // If an explicit RM was chosen, it must be a user in this firm — otherwise
      // the new client would be owned by an out-of-tenant uuid.
      if (body.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, body.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return { badRm: true as const };
      }

      // null when no PAN supplied — the DB column is nullable (migration 0129).
      const pan = body.pan && body.pan.trim() ? normalizePan(body.pan) : null;

      // Create investor
      const inserted = await tx
        .insert(investors)
        .values({
          id: investorId,
          tenantId: session.tenantId,
          branchId: lead.branchId ?? session.branchId,
          name: lead.name,
          pan,
          email: lead.email,
          phone: lead.phone,
          whatsappPhone: lead.phone,
          address: lead.city ? ({ city: lead.city, country: "India" } as any) : null,
          segmentTag: body.segmentTag,
          investorCategory: body.investorCategory,
          // Carry the referral forward — this is the referee's own profile
          // now, and until this fix it silently dropped who referred them
          // (the lead recorded it, the new investor row never did).
          referralClientName: lead.referredByName ?? null,
          rmId: body.rmId ?? lead.ownerId ?? session.userId,
          status: "active",
          onboardedAt: new Date(),
          notes: body.notes ?? lead.notes ?? null,
          kycStatus: "pending",
        } as any)
        .returning();

      // Stamp lead
      await tx
        .update(leads)
        .set({
          stage: "converted",
          stageChangedAt: new Date(),
          ...(pan ? { pan } : {}),
          convertedInvestorId: investorId,
          convertedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(leads.id, leadId));

      // A research subscription follows the person across conversion: category,
      // frequency and the renewal date already worked out on the lead.
      await tx.execute(sql`
        UPDATE investors i
           SET subscription_category = l.subscription_category,
               subscription_frequency = l.subscription_frequency,
               subscription_started_at = l.subscription_started_at,
               subscription_renewal_at = l.subscription_renewal_at
          FROM leads l
         WHERE l.id = ${leadId}::uuid AND i.id = ${investorId}::uuid
      `);

      // ─── DATA CARRYOVER ──────────────────────────────────────────────
      // Per the spec: no data should be lost on conversion. We re-point
      // every related record from the lead onto the new investor.
      //
      // CRITICAL: the whole carryover runs inside a SAVEPOINT (nested tx) so
      // a DB-level error in any single step — a column/table mismatch, a
      // constraint, a statement timeout — rolls back ONLY the carryover, not
      // the parent transaction. Without this isolation, a thrown SQL error
      // here would abort the entire Postgres tx, the investor INSERT would
      // never commit, and the API would return a bare "internal" 500 with no
      // client created. The client being created is far more important than a
      // perfect carryover; a partial-carryover failure is logged, not fatal.
      try {
        await tx.transaction(async (sp) => {
          // 1. Risk profile responses — the lead's responses used `lead_id` in
          //    `investor_id` polymorphically (see /api/public/risk-profile/submit).
          //    Repoint to the actual investor so investor.riskProfile lines up.
          const carriedRpr = await sp.execute(sql`
            UPDATE risk_profile_responses
               SET investor_id = ${investorId}::uuid,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND investor_id = ${leadId}::uuid
            RETURNING id, final_category, total_score, signed_at
          `);
          const latestRisk = (carriedRpr.rows as any[])[0];
          if (latestRisk) {
            // signed_at comes back as a string from raw sp.execute (Postgres
            // formatted timestamp). Drizzle's update on a timestamp column
            // calls value.toISOString() — so we MUST hand it a real Date.
            const signedAt = latestRisk.signed_at ? new Date(latestRisk.signed_at) : null;
            await sp
              .update(investors)
              .set({
                riskProfile: latestRisk.final_category as any,
                riskProfileScore: Number(latestRisk.total_score),
                riskProfileSignedAt: signedAt,
                updatedAt: new Date(),
              } as any)
              .where(eq(investors.id, investorId));
          }

          // 2. Proposals — re-point lead-bound proposals to carry the investor
          await sp
            .update(proposals)
            .set({ investorId, recipientType: "investor" as any, updatedAt: new Date() } as any)
            .where(eq(proposals.leadId, leadId));

          // 3. Compliance documents (KYC uploads) — were saved with
          //    related_entity_type='lead' + related_entity_id=leadId. Move them.
          await sp.execute(sql`
            UPDATE compliance_documents
               SET related_entity_type = 'investor',
                   related_entity_id = ${investorId}::uuid,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND related_entity_type = 'lead'
               AND related_entity_id = ${leadId}::uuid
          `);

          // 4. Communications — set investor_id on lead-bound rows so the
          //    investor's timeline picks them up.
          await sp
            .update(communications)
            .set({ investorId, updatedAt: new Date() } as any)
            .where(eq(communications.leadId, leadId));

          // 5. Meetings (review_meetings) — repoint lead → investor.
          await sp.execute(sql`
            UPDATE review_meetings
               SET investor_id = ${investorId}::uuid,
                   lead_id = NULL,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND lead_id = ${leadId}::uuid
          `);

          // 6. Open share_tokens (proposal approval, doc collection, risk
          //    profile) pointing at the lead → repoint so links keep working.
          await sp.execute(sql`
            UPDATE share_tokens
               SET subject_type = 'investor',
                   subject_id = ${investorId}::uuid,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND subject_type = 'lead'
               AND subject_id = ${leadId}::uuid
               AND used_at IS NULL
          `);

          // 7. KYC data the client filled via the public onboarding link while
          //    still a lead → apply it to the new investor's client master.
          const kyc = (lead as any).kycData as Record<string, string> | null;
          if (kyc && Object.keys(kyc).length > 0) {
            const base = inserted[0] as any;
            const upd = mapKycFieldsToInvestorUpdate(kyc, {
              pan: base?.pan,
              email: base?.email,
              phone: base?.phone,
              whatsappPhone: base?.whatsappPhone,
              address: base?.address,
              bankAccounts: base?.bankAccounts,
              nominees: base?.nominees,
            });
            await sp
              .update(investors)
              .set({ ...upd, kycData: kyc, updatedAt: new Date() } as any)
              .where(eq(investors.id, investorId));
          }
        });
      } catch (carryErr) {
        console.warn(
          `[lead.convert] carryover failed for lead ${leadId} → investor ${investorId} (client still created):`,
          (carryErr as Error)?.message
        );
      }

      // Outbox events — let subscribed workflows kick in.
      // `inserted[0]` contains Date objects from Drizzle's returning(); we
      // round-trip through JSON.stringify so the JSONB column gets plain
      // ISO-string dates instead of native Date instances (which trip
      // Drizzle's value formatter inside jsonb: "value.toISOString is not
      // a function" on the next downstream consumer).
      const investorSnapshot = JSON.parse(JSON.stringify(inserted[0] ?? {}));
      await tx.insert(eventsOutbox).values([
        {
          tenantId: session.tenantId,
          kind: "lead.converted",
          entityType: "lead",
          entityId: leadId,
          after: { investorId } as any,
          meta: { userId: session.userId } as any,
        },
        {
          tenantId: session.tenantId,
          kind: "investor.created",
          entityType: "investor",
          entityId: investorId,
          after: investorSnapshot as any,
          meta: { userId: session.userId, source: "lead_conversion", leadId } as any,
        },
      ] as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.convert",
        entityType: "lead",
        entityId: leadId,
        after: { investorId, leadName: lead.name },
        ...clientMeta,
      });

      // Referral recognition (closed loop). The lead_welcome recipe already
      // thanked the referrer when the lead came in; now that it has actually
      // CONVERTED, task the owning RM to recognise the referrer personally —
      // genuine recognition is what drives the next referral.
      if (lead.referredByInvestorId) {
        try {
          await tx.transaction(async (sp) => {
            await sp.execute(sql`
              INSERT INTO tasks (
                id, tenant_id, title, description, status, priority,
                assignee_id, due_at, kind, created_by, created_at, updated_at
              )
              VALUES (
                gen_random_uuid(), ${session.tenantId}::uuid,
                ${`Thank ${lead.referredByName ?? "your client"} — their referral just converted`},
                ${`${lead.name} (referred by ${lead.referredByName ?? "an existing client"}) is now a client. Call the referrer within 2 days to thank them — referral recognition is the cheapest growth you have.`},
                'open', 'normal',
                ${lead.ownerId ?? session.userId}::uuid,
                now() + interval '2 days',
                'admin',
                ${session.userId}::uuid,
                now(), now()
              )
            `);
          });
        } catch (refErr) {
          console.warn(
            `[lead.convert] referral-recognition task insert failed for lead ${leadId}:`,
            (refErr as Error)?.message
          );
        }
      }

      // Push the shared blueprint instance into the client phase so the
      // freshly-converted client appears in the right column of the
      // Clients Kanban (Request Documents) — instead of being stuck at
      // won_lead, which is a lead-phase stage with no representation in
      // the client kanban (cards would fall back to the Active Client
      // column and refuse to advance forward).
      await autoAdvance(tx, session.tenantId, leadId, "client.converted", {
        remarks: "Lead converted to client — entering onboarding phase.",
      });

      return { investorId, alreadyConverted: false };
    });

    if ("badRm" in result) {
      return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("investors_tenant_pan_unique")) {
      return NextResponse.json(
        { error: "An investor with this PAN already exists — use the existing record." },
        { status: 409 }
      );
    }
    return handleApiError(err);
  }
}
