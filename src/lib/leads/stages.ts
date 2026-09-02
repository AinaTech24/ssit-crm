/**
 * Canonical lead/blueprint stage presentation — ONE source of truth for how a
 * stage looks (colour) and reads (label), covering every value in the leads
 * stage enum (50+: lead-phase, client-phase, onboarding, legacy).
 *
 * Previously each surface kept its own partial colour map, so the lead detail
 * page only coloured 7 legacy stages and everything else rendered as a blank
 * chip. This maps stages to a small set of tones by FAMILY (with a graceful
 * slate fallback), so any stage — current or future — always renders sensibly.
 */

export type StageTone = "blue" | "cyan" | "amber" | "indigo" | "purple" | "teal" | "emerald" | "rose" | "slate";

const TONE_CLASS: Record<StageTone, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};

/** Explicit overrides for human-friendly labels where title-case isn't enough. */
const LABEL_OVERRIDES: Record<string, string> = {
  kyc_validated: "KYC Validated",
  kyc_registered: "KYC Registered",
  kyc_pending: "KYC Pending",
  modify_kyc: "Modify KYC",
  physical_kyc: "Physical KYC",
  online_kyc: "Online KYC",
  ucc_create: "Create UCC",
  ucc_activated: "UCC Activated",
  mandate_create: "Create Mandate",
  mandate_activated: "Mandate Activated",
  mandate_reject: "Mandate Rejected",
  mandate_rejected: "Mandate Rejected",
  add_in_review_sheet: "Active Client",
  won_lead: "Won",
  not_qualified: "Not Qualified",
};

/** Title-case a snake_case stage key. */
export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  if (LABEL_OVERRIDES[stage]) return LABEL_OVERRIDES[stage];
  return stage
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Map a stage to a tone by family. */
export function stageTone(stage: string | null | undefined): StageTone {
  const s = stage ?? "";
  // Terminal-negative
  if (/(^|_)(lost|not_interested|not_qualified|cold|reject|rejected|failed)$/.test(s) || s === "cold") return "rose";
  // Won / completed
  if (/(converted|won_lead|transaction_successful|ucc_activated|mandate_activated|kyc_validated|kyc_registered|add_in_review_sheet)/.test(s)) return "emerald";
  // New / top of funnel
  if (s === "new") return "blue";
  // Contact attempts
  if (/(contacted|call_done|call_back_later|call_not_connected|contact_in_future|follow_up)/.test(s)) return "cyan";
  // Meetings
  if (/meeting/.test(s)) return "amber";
  // Proposal / risk
  if (/(proposal|risk_profile|risk_profiled)/.test(s)) return "purple";
  // Onboarding / ops (docs, kyc, ucc, mandate, transaction)
  if (/(doc|kyc|ucc|mandate|transaction|family_mapping|update_information)/.test(s)) return "indigo";
  if (/qualified/.test(s)) return "teal";
  return "slate";
}

/** Combined chip class for a stage (border + bg + text). */
export function stageBadgeClass(stage: string | null | undefined): string {
  return TONE_CLASS[stageTone(stage)];
}
