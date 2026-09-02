/**
 * Stage prerequisites for the Lead → Client journey.
 *
 * Every manual advance from stage A → B asks: "what should already exist
 * before we move on?" — captured here as a checklist of artefacts:
 *
 *   - completed meeting (for meeting_done)
 *   - risk profile response (for risk_profiled)
 *   - proposal in sent status (for proposal_sent)
 *   - approval evidence row (for proposal_approved)
 *   - … and so on.
 *
 * Each prerequisite carries:
 *   - a human label ("A scheduled meeting must exist")
 *   - a boolean `satisfied` computed against the DB
 *   - an optional `cta { href, label }` linking the user straight to the
 *     page where they can complete it.
 *
 * The transitionTo engine refuses to advance when any prerequisite is
 * unsatisfied (unless systemBypass=true is passed for auto-advance from
 * actions like "meeting completed" — the system already knows the
 * artefact exists because it just created it).
 *
 * Why this matters: stages are how the firm signals readiness for the
 * next step. Advancing without the underlying artefacts produces
 * compliance gaps later (e.g. proposal_sent with no proposal on file).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type Prerequisite = {
  label: string;
  satisfied: boolean;
  /** Optional one-line tip shown when the item is unsatisfied. */
  hint?: string;
  /** Direct link to the page where the user can complete this. */
  cta?: { href: string; label: string };
};

export type PrereqCheck = {
  /** True if every prerequisite is satisfied — safe to advance. */
  ok: boolean;
  /** The full list — both satisfied + unsatisfied, in display order. */
  items: Prerequisite[];
};

/**
 * Compute the prerequisite checklist for advancing a given lead to a
 * target stage. Empty list = "no prerequisites; user can advance freely."
 *
 * The function only inspects DB state — it never side-effects. Safe to
 * call repeatedly from the dialog as the user completes items.
 */
export async function checkPrerequisites(
  tx: Tx,
  tenantId: string,
  leadId: string,
  targetStageKey: string
): Promise<PrereqCheck> {
  const rules = PREREQ_RULES_BY_TARGET[targetStageKey] ?? [];
  // Run each rule defensively: a single failing check (bad query, timeout)
  // becomes an unsatisfied "couldn't verify" item — it blocks the advance and
  // shows in the checklist, instead of throwing a 500 that reads as
  // "Couldn't check this step".
  const items = await Promise.all(
    rules.map(async (rule) => {
      try {
        return await rule(tx, tenantId, leadId);
      } catch {
        return {
          label: "Could not verify this step",
          satisfied: false,
          hint: "A check couldn't run. Try again, or use “Or pick a stage manually” to proceed.",
        } as Prerequisite;
      }
    })
  );
  return { ok: items.every((i) => i.satisfied), items };
}

// ── Rule helpers (run a single query, return a Prerequisite) ────────────

type RuleFn = (tx: Tx, tenantId: string, leadId: string) => Promise<Prerequisite>;

const hasScheduledMeeting: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM review_meetings
    WHERE lead_id = ${leadId}::uuid AND status IN ('scheduled', 'completed')
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "A meeting is scheduled with this lead",
    satisfied: c > 0,
    hint: "Click below to schedule one — we'll pre-fill the lead.",
    cta: { href: `/dashboard/review-meetings/new?leadId=${leadId}`, label: "Schedule meeting" },
  };
};

const hasCompletedMeeting: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM review_meetings
    WHERE lead_id = ${leadId}::uuid AND status = 'completed'
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "The scheduled meeting is marked completed",
    satisfied: c > 0,
    hint: "Open the meeting and click Mark Completed once you've held it.",
    cta: { href: `/dashboard/review-meetings?leadId=${leadId}`, label: "Open meetings" },
  };
};

const hasCallOutcome: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT last_contact_at, follow_up_notes FROM leads WHERE id = ${leadId}::uuid LIMIT 1
  `);
  const row = (r.rows[0] as any) ?? {};
  const satisfied = !!(row.last_contact_at || (row.follow_up_notes && row.follow_up_notes.length > 0));
  return {
    label: "Outcome of the first call has been logged",
    satisfied,
    hint: "Use the 'Log activity' button on the lead header to capture how the call went.",
    cta: { href: `/dashboard/leads/${leadId}`, label: "Open lead" },
  };
};

const hasRiskProfileLinkSent: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM share_tokens
    WHERE kind = 'risk_profile'
      AND ((subject_type = 'lead' AND subject_id = ${leadId}::uuid)
           OR subject_id = ${leadId}::uuid)
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "Risk-profile link has been sent to the lead",
    satisfied: c > 0,
    hint: "Use the 'Send risk profile' card under Onboarding actions.",
    cta: { href: `/dashboard/leads/${leadId}`, label: "Open lead" },
  };
};

const hasRiskProfileResponse: RuleFn = async (tx, _tenantId, leadId) => {
  // The lead's risk profile lives on risk_profile_responses with investor_id
  // pointing at either the lead id (pre-conversion) or the converted
  // investor id (post-conversion).
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM risk_profile_responses rpr
    WHERE rpr.investor_id = ${leadId}::uuid
       OR rpr.investor_id = (SELECT converted_investor_id FROM leads WHERE id = ${leadId}::uuid)
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "Risk profile has been submitted (or manually captured)",
    satisfied: c > 0,
    hint: "Either the client submits via the share link, or you can capture it manually.",
    cta: { href: `/dashboard/leads/${leadId}`, label: "Open lead" },
  };
};

const hasProposalDraft: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM proposals WHERE lead_id = ${leadId}::uuid
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "A proposal has been drafted for this lead",
    satisfied: c > 0,
    hint: "Click below to create one — pre-filled with risk profile and goals.",
    cta: { href: `/dashboard/proposals/new?leadId=${leadId}`, label: "Create proposal" },
  };
};

const hasProposalSent: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM proposals
    WHERE lead_id = ${leadId}::uuid AND status IN ('sent', 'viewed', 'accepted')
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "The proposal has been sent (Email / WhatsApp)",
    satisfied: c > 0,
    hint: "Open the draft proposal and click Send via email or WhatsApp.",
    cta: { href: `/dashboard/proposals?leadId=${leadId}`, label: "Open proposals" },
  };
};

const hasProposalApproval: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM proposal_approvals pa
    INNER JOIN proposals p ON p.id = pa.proposal_id
    WHERE p.lead_id = ${leadId}::uuid
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "Client has approved the proposal",
    satisfied: c > 0,
    hint: "Either capture digital approval on /p/[token] or record verbal approval.",
    cta: { href: `/dashboard/proposals?leadId=${leadId}`, label: "Open proposals" },
  };
};

const hasDocChecklistSent: RuleFn = async (tx, _tenantId, leadId) => {
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM share_tokens
    WHERE kind = 'document_collection'
      AND ((subject_type = 'lead' AND subject_id = ${leadId}::uuid)
           OR subject_id = ${leadId}::uuid)
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "Document-collection link has been sent",
    satisfied: c > 0,
    hint: "Use the 'Send document collection' card under Onboarding actions.",
    cta: { href: `/dashboard/leads/${leadId}`, label: "Open lead" },
  };
};

const hasDocsUploaded: RuleFn = async (tx, _tenantId, leadId) => {
  // Documents live in compliance_documents, keyed by related_entity_id (NOT
  // subject_id — that column doesn't exist; referencing it 500'd this whole
  // check). Match the subject id directly, plus the converted investor id when
  // this is a post-conversion client. RLS scopes to the tenant.
  const r = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM compliance_documents
    WHERE related_entity_id = ${leadId}::uuid
       OR related_entity_id = (SELECT converted_investor_id FROM leads WHERE id = ${leadId}::uuid)
  `);
  const c = (r.rows[0] as any)?.c ?? 0;
  return {
    label: "Onboarding documents have been received",
    satisfied: c > 0,
    hint: "Upload the client's KYC documents on their behalf (or wait for them to use the upload link), then mark Documents Received.",
    cta: { href: `/dashboard/leads/${leadId}`, label: "Open record" },
  };
};

// ── Rule map — target stage key → rules to run ───────────────────────────

// IMPORTANT: keys are CANONICAL stage keys (post-`normalizeLeadStage`), matching
// the live 30-stage Lead → Client SOP in lead_to_client.ts. The advance and
// can-advance routes both normalize `toStageKey` before calling
// checkPrerequisites, so keying this map on legacy aliases (the previous bug)
// made it a no-op for every stage but one. A target absent from this map has no
// artefact prerequisite and may advance freely.
//
// These are enforced server-side by transitionTo() (skipped on systemBypass /
// auto-advance / explicit override) and surfaced read-only by GET /can-advance.
const PREREQ_RULES_BY_TARGET: Record<string, RuleFn[]> = {
  // Meeting must be scheduled before Meeting Scheduled.
  meeting_scheduled: [hasScheduledMeeting],
  // Meeting must be completed before Meeting Done.
  meeting_done: [hasCompletedMeeting],
  // First-call outcome / qualification captured before Won Lead.
  won_lead: [hasCallOutcome],
  // Documents on file before Documents Received.
  documents_received: [hasDocsUploaded],
};

// Retained for future SOP variants that re-introduce a risk-profile / proposal
// gate; referenced here so they aren't flagged unused while the current 30-stage
// graph collapses those steps into Won Lead.
void [hasRiskProfileLinkSent, hasRiskProfileResponse, hasProposalDraft, hasProposalSent, hasProposalApproval, hasDocChecklistSent];
