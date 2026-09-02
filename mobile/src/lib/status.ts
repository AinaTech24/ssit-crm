/**
 * Status → badge mapping. Every entity status enum maps to a { label, tone } so
 * StatusPill renders consistent, meaningful colors across the app. Mirrors the
 * status values in the backend schema (src/db/schema/*).
 */

import type { Tone } from "../theme";
import { titleCase } from "./format";

export interface Badge {
  label: string;
  tone: Tone;
}

function map(dict: Record<string, Badge>, value?: string | null, fallbackTone: Tone = "neutral"): Badge {
  if (!value) return { label: "—", tone: "neutral" };
  return dict[value] ?? { label: titleCase(value), tone: fallbackTone };
}

const INVESTOR_STATUS: Record<string, Badge> = {
  active: { label: "Active", tone: "success" },
  dormant: { label: "Dormant", tone: "warning" },
  inactive: { label: "Inactive", tone: "neutral" },
  redemption_risk: { label: "Redemption Risk", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
  exited: { label: "Exited", tone: "neutral" },
};

const KYC_STATUS: Record<string, Badge> = {
  verified: { label: "KYC Verified", tone: "success" },
  registered: { label: "KYC Registered", tone: "info" },
  pending: { label: "KYC Pending", tone: "warning" },
  hold: { label: "KYC Hold", tone: "warning" },
  rejected: { label: "KYC Rejected", tone: "danger" },
  expired: { label: "KYC Expired", tone: "danger" },
  re_kyc_required: { label: "Re-KYC", tone: "warning" },
};

const HEALTH_BAND: Record<string, Badge> = {
  green: { label: "Healthy", tone: "success" },
  amber: { label: "Watch", tone: "warning" },
  red: { label: "At Risk", tone: "danger" },
};

const LEAD_STAGE_TONE: Record<string, Tone> = {
  new: "info",
  converted: "success",
  won: "success",
  lost: "danger",
  not_interested: "danger",
  not_qualified: "danger",
};

const TASK_STATUS: Record<string, Badge> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In Progress", tone: "brand" },
  blocked: { label: "Blocked", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const MEETING_STATUS: Record<string, Badge> = {
  scheduled: { label: "Scheduled", tone: "info" },
  confirmed: { label: "Confirmed", tone: "brand" },
  in_progress: { label: "In Progress", tone: "brand" },
  completed: { label: "Completed", tone: "success" },
  rescheduled: { label: "Rescheduled", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No Show", tone: "danger" },
};

const ENTRY_STATUS: Record<string, Badge> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  submitted: { label: "Submitted", tone: "info" },
  confirmed: { label: "Confirmed", tone: "success" },
  processed: { label: "Processed", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const PROPOSAL_STATUS: Record<string, Badge> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  sent: { label: "Sent", tone: "brand" },
  viewed: { label: "Viewed", tone: "brand" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

const INSURANCE_STATUS: Record<string, Badge> = {
  proposed: { label: "Proposed", tone: "info" },
  in_underwriting: { label: "Underwriting", tone: "warning" },
  active: { label: "Active", tone: "success" },
  lapsed: { label: "Lapsed", tone: "danger" },
  matured: { label: "Matured", tone: "neutral" },
  surrendered: { label: "Surrendered", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  claim_filed: { label: "Claim Filed", tone: "warning" },
  claim_settled: { label: "Claim Settled", tone: "success" },
};

const CAMPAIGN_STATUS: Record<string, Badge> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  sending: { label: "Sending", tone: "brand" },
  sent: { label: "Sent", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const SR_STATUS: Record<string, Badge> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In Progress", tone: "brand" },
  awaiting_client: { label: "Awaiting Client", tone: "warning" },
  awaiting: { label: "Awaiting", tone: "warning" },
  escalated: { label: "Escalated", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const proposalStatusBadge = (v?: string | null) => map(PROPOSAL_STATUS, v, "info");
export const insuranceStatusBadge = (v?: string | null) => map(INSURANCE_STATUS, v, "info");
export const campaignStatusBadge = (v?: string | null) => map(CAMPAIGN_STATUS, v, "info");
export const srStatusBadge = (v?: string | null) => map(SR_STATUS, v, "info");
export const meetingStatusBadge = (v?: string | null) => map(MEETING_STATUS, v, "info");
export const entryStatusBadge = (v?: string | null) => map(ENTRY_STATUS, v, "info");
export const investorStatusBadge = (v?: string | null) => map(INVESTOR_STATUS, v);
export const kycBadge = (v?: string | null) => map(KYC_STATUS, v, "info");
export const healthBadge = (v?: string | null) => map(HEALTH_BAND, v);
export const taskStatusBadge = (v?: string | null) => map(TASK_STATUS, v, "info");

/** Lead stages are ~50 values; color the notable ones, title-case the rest. */
export function leadStageBadge(v?: string | null): Badge {
  if (!v) return { label: "—", tone: "neutral" };
  return { label: titleCase(v), tone: LEAD_STAGE_TONE[v] ?? "brand" };
}
