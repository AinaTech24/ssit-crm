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
import { carryLeadRecords } from "@/lib/leads/carry-over";
import {
  leads,
  investors,
  users,
  eventsOutbox,
  proposals,
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
          referredByInvestorId: lead.referredByInvestorId ?? null,
          referredByInvestorIds: lead.referredByInvestorId ? [lead.referredByInvestorId] : [],
          rmId: body.rmId ?? lead.ownerId ?? session.userId,
          // The lead's service RM carries over; null falls back to the RM (trigger 0244).
          serviceRmId: lead.serviceRmId ?? null,
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
      // Documents, activities, notes, tasks, meetings, proposals ... move onto the client
      // (lib/leads/carry-over.ts). Each step is isolated: a failure never costs the others,
      // and never the client record itself.
      await carryLeadRecords(tx, {
        tenantId: session.tenantId,
        leadId,
        investorId,
        branchId: lead.branchId ?? session.branchId,
        actorUserId: session.userId,
        lead,
        investorRow: inserted[0],
      });

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
