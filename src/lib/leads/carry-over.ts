/**
 * Moving a lead's records onto the client it became: no data should be lost on conversion.
 *
 * Every step runs in its OWN savepoint. It used to be one savepoint around all of them, so a single failing step
 * rolled every other one back and the client appeared with no documents, meetings or notes at all. Now a failure
 * is logged and only that step is skipped; the client is created either way.
 */

import { eq, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { activities, communications, investors, proposals } from "@/db/schema";
import { mapKycFieldsToInvestorUpdate } from "@/lib/onboarding/kyc-fields";

type LeadLike = {
  name: string;
  phone?: string | null;
  ownerId?: string | null;
  notes?: string | null;
  followUpNotes?: string | null;
  kycData?: unknown;
};

export async function carryLeadRecords(
  tx: any,
  args: {
    tenantId: string;
    leadId: string;
    investorId: string;
    branchId?: string | null;
    actorUserId: string;
    lead: LeadLike;
    /** The investor row as inserted (what the KYC mapping builds on). */
    investorRow: any;
  }
): Promise<{ failed: string[] }> {
  const { tenantId, leadId, investorId, lead } = args;
  const failed: string[] = [];
  async function step(name: string, run: (sp: any) => Promise<void>) {
    try {
      await tx.transaction(async (sp: any) => run(sp));
    } catch (err) {
      failed.push(name);
      console.warn(`[lead.convert] carry-over step "${name}" failed for lead ${leadId} -> investor ${investorId}:`, (err as Error)?.message);
    }
  }

  // Documents (KYC uploads and anything else filed on the lead).
  await step("documents", async (sp) => {
    await sp.execute(sql`
      UPDATE compliance_documents
         SET related_entity_type = 'investor', related_entity_id = ${investorId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND related_entity_type = 'lead' AND related_entity_id = ${leadId}::uuid
    `);
  });

  // Calls, visits, notes ... logged against the lead - the client's history and Engagement notes.
  await step("activities", async (sp) => {
    await sp.execute(sql`
      UPDATE activities
         SET subject_type = 'investor', subject_id = ${investorId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND subject_type = 'lead' AND subject_id = ${leadId}::uuid
    `);
  });

  // The lead's own notes boxes become one note on the client.
  await step("lead-notes", async (sp) => {
    const parts = [
      lead.followUpNotes?.trim() ? `Follow-up notes:\n${lead.followUpNotes.trim()}` : "",
      lead.notes?.trim() ? `Internal notes:\n${lead.notes.trim()}` : "",
    ].filter(Boolean);
    if (!parts.length) return;
    await sp.insert(activities).values({
      id: uuid(),
      tenantId,
      branchId: args.branchId ?? null,
      subjectType: "investor",
      subjectId: investorId,
      subjectName: lead.name,
      subjectPhone: lead.phone ?? null,
      kind: "note",
      subject: "Notes from the lead stage",
      notes: parts.join("\n\n").slice(0, 20000),
      occurredAt: new Date(),
      ownerUserId: lead.ownerId ?? args.actorUserId,
    });
  });

  await step("tasks", async (sp) => {
    await sp.execute(sql`
      UPDATE tasks
         SET related_investor_id = ${investorId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND related_investor_id IS NULL
         AND (related_lead_id = ${leadId}::uuid OR (subject_type = 'lead' AND subject_id = ${leadId}::uuid))
    `);
  });

  await step("meetings", async (sp) => {
    await sp.execute(sql`
      UPDATE review_meetings
         SET investor_id = ${investorId}::uuid, lead_id = NULL, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
    `);
  });

  await step("proposals", async (sp) => {
    await sp
      .update(proposals)
      .set({ investorId, recipientType: "investor" as any, updatedAt: new Date() })
      .where(eq(proposals.leadId, leadId));
  });

  await step("communications", async (sp) => {
    await sp.update(communications).set({ investorId, updatedAt: new Date() }).where(eq(communications.leadId, leadId));
  });

  // Risk profile responses - the lead's responses used the lead id in `investor_id`.
  await step("risk-profile", async (sp) => {
    const carried = await sp.execute(sql`
      UPDATE risk_profile_responses
         SET investor_id = ${investorId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${leadId}::uuid
      RETURNING id, final_category, total_score, signed_at
    `);
    const latest = (carried.rows as any[])[0];
    if (!latest) return;
    // signed_at comes back as a string from raw execute; the timestamp column needs a Date.
    await sp
      .update(investors)
      .set({
        riskProfile: latest.final_category,
        riskProfileScore: Number(latest.total_score),
        riskProfileSignedAt: latest.signed_at ? new Date(latest.signed_at) : null,
        updatedAt: new Date(),
      })
      .where(eq(investors.id, investorId));
  });

  // Open public links (proposal approval, document collection, risk profile) keep working.
  await step("share-links", async (sp) => {
    await sp.execute(sql`
      UPDATE share_tokens
         SET subject_type = 'investor', subject_id = ${investorId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND subject_type = 'lead' AND subject_id = ${leadId}::uuid AND used_at IS NULL
    `);
  });

  // KYC details the person filled on the public onboarding link while still a lead.
  await step("kyc", async (sp) => {
    const kyc = lead.kycData as Record<string, string> | null;
    if (!kyc || Object.keys(kyc).length === 0) return;
    const base = args.investorRow;
    const upd = mapKycFieldsToInvestorUpdate(kyc, {
      pan: base?.pan,
      email: base?.email,
      phone: base?.phone,
      whatsappPhone: base?.whatsappPhone,
      address: base?.address,
      bankAccounts: base?.bankAccounts,
      nominees: base?.nominees,
    });
    await sp.update(investors).set({ ...upd, kycData: kyc, updatedAt: new Date() } as any).where(eq(investors.id, investorId));
  });

  return { failed };
}
