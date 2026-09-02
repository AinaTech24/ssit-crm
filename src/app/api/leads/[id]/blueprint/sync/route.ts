import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/blueprint/sync
 *
 * Reconciles a lead's blueprint stage with its actual journey artefacts.
 * Looks at: risk_profile_responses, proposals + proposal_approvals,
 * compliance_documents (KYC type), and the lead's converted_investor_id —
 * then advances the blueprint instance to the furthest stage that's
 * actually been reached.
 *
 * This is the recovery path for leads created BEFORE the share-token /
 * public-form flows started transitioning the blueprint automatically.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  riskProfileResponses,
  proposals,
  proposalApprovals,
  complianceDocuments,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { transitionTo } from "@/lib/blueprints/engine";
import { LEAD_TO_CLIENT_STAGES } from "@/lib/blueprints/lead_to_client";
import { loadEditableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

const STAGE_ORDER = new Map(LEAD_TO_CLIENT_STAGES.map((s) => [s.key, s.order]));
const orderOf = (key?: string | null) => (key ? STAGE_ORDER.get(key) ?? 0 : 0);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);

      // The sync backfill should only ever move a lead FORWARD to the furthest
      // stage its artefacts justify — never regress one a human already pushed
      // further. Read the current stage once and gate every advance on it.
      const cur = await tx.execute(
        sql`SELECT current_stage_key FROM lead_blueprint_instances WHERE lead_id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1` as any
      );
      const currentKey = (cur.rows?.[0] as any)?.current_stage_key as string | undefined;
      const currentOrder = orderOf(currentKey);

      const advanceIfForward = async (target: string, reason: string) => {
        if (orderOf(target) <= currentOrder) {
          return { advancedTo: currentKey ?? target, reason: `Already at or beyond ${target} — no change.` };
        }
        await transitionTo(tx, session.tenantId, id, target, { systemBypass: true, remarks: reason });
        return { advancedTo: target, reason };
      };

      // 1. Already converted?
      if (lead.convertedInvestorId) {
        return advanceIfForward("request_documents", "Backfill — lead already converted to client.");
      }

      // 2. Documents on file?
      const docs = await tx
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.relatedEntityType, "lead"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        );
      if (docs.length > 0) {
        return advanceIfForward("documents_received", `Backfill — ${docs.length} KYC doc(s) on file.`);
      }

      // 3. Proposal approved / sent / drafted?
      const [leadProposal] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.leadId, id))
        .orderBy(desc(proposals.createdAt))
        .limit(1);
      if (leadProposal) {
        const [approval] = await tx
          .select()
          .from(proposalApprovals)
          .where(eq(proposalApprovals.proposalId, leadProposal.id))
          .limit(1);
        if (approval) return advanceIfForward("won_lead", "Backfill — proposal already approved.");
        if (leadProposal.status === "sent" || leadProposal.status === "viewed") {
          return advanceIfForward("won_lead", "Backfill — proposal already sent.");
        }
        if (leadProposal.status === "draft" || leadProposal.status === "ready") {
          return advanceIfForward("won_lead", "Backfill — proposal in draft.");
        }
      }

      // 4. Risk profile on file?
      const [risk] = await tx
        .select()
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.investorId, id))
        .orderBy(desc(riskProfileResponses.signedAt))
        .limit(1);
      if (risk) {
        return advanceIfForward("won_lead", `Backfill — risk profile on file (${risk.finalCategory}, ${risk.totalScore}).`);
      }

      // 5. Just contacted?
      if (lead.lastContactAt) {
        return advanceIfForward("call_done", "Backfill — last contact on file.");
      }

      return { advancedTo: currentKey ?? "new", reason: "No journey artefacts found yet" };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
