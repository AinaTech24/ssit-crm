/**
 * Lead temperature + aging helpers.
 *
 * Pure functions — usable from any server or client component. No DB calls,
 * no network calls. Feed them the lead row + last-activity timestamp.
 *
 * Temperature model:
 *   - HOT     — recent activity (<7d), advanced stage (meeting_done/won_lead),
 *               OR explicit follow-up scheduled in next 48h
 *   - WARM    — some activity in last 30d, mid-funnel stage
 *   - COLD    — no activity in 30+ days, or stuck > 14 days in same stage
 *   - LOST    — terminal stages (not_qualified / lost / not_interested)
 *
 * Aging is days-in-current-stage, derived from `stageChangedAt` (preferred)
 * or `updatedAt` (fallback for legacy rows that don't track stage transitions).
 */

import { scoreLead } from "./score";

export type LeadTemperature = "hot" | "warm" | "cold" | "lost";

export type LeadForScoring = {
  stage: string;
  stageChangedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  lastContactAt?: Date | string | null;
  lastFollowUpAt?: Date | string | null;
  nextFollowUpAt?: Date | string | null;
  intendedAmount?: string | null;
  source?: string | null;
  convertedInvestorId?: string | null;
};

/** Stages we treat as "hot by default" — late-funnel intent signals. */
const HOT_STAGES = new Set([
  "meeting_scheduled",
  "meeting_done",
  "won_lead",
  "post_meeting_qualified",
  "proposal_shared",
  "proposal_approved",
  "risk_profiled",
  "docs_received",
  "documents_received",
]);

/** Terminal stages where the lead is effectively closed-lost. */
const LOST_STAGES = new Set([
  "not_qualified",
  "lost",
  "not_interested",
  "cold",
]);

/** Mid-funnel stages where steady engagement is the norm. */
const MID_STAGES = new Set([
  "contacted",
  "call_done",
  "follow_up",
  "contact_in_future",
  "call_back_later",
  "meeting_pending",
  "risk_profile_sent",
  "proposal_drafted",
  "docs_requested",
]);

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function daysSince(v: Date | string | null | undefined, now = new Date()): number | null {
  const d = toDate(v);
  if (!d || isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/**
 * Days the lead has been sitting in its current stage. Uses
 * `stageChangedAt` when set, else falls back to `updatedAt` then `createdAt`.
 */
export function stageAgingDays(lead: LeadForScoring, now = new Date()): number | null {
  return (
    daysSince(lead.stageChangedAt, now) ??
    daysSince(lead.updatedAt, now) ??
    daysSince(lead.createdAt, now)
  );
}

/**
 * Last meaningful contact — newest of lastContactAt, lastFollowUpAt, updatedAt.
 */
export function lastTouchDays(lead: LeadForScoring, now = new Date()): number | null {
  const candidates = [lead.lastContactAt, lead.lastFollowUpAt, lead.updatedAt]
    .map((v) => toDate(v))
    .filter((d): d is Date => d != null && !isNaN(d.getTime()))
    .map((d) => d.getTime());
  if (candidates.length === 0) return null;
  return Math.floor((now.getTime() - Math.max(...candidates)) / 86_400_000);
}

/**
 * Is the next follow-up overdue? Returns null if no follow-up is scheduled.
 */
export function followUpOverdue(lead: LeadForScoring, now = new Date()): boolean | null {
  const d = toDate(lead.nextFollowUpAt);
  if (!d) return null;
  return d.getTime() < now.getTime();
}

/**
 * Compute the lead temperature using stage + recency signals.
 * Cheap, deterministic, side-effect-free.
 */
export function leadTemperature(lead: LeadForScoring, now = new Date()): LeadTemperature {
  if (lead.convertedInvestorId) return "hot"; // already converted — historic
  if (LOST_STAGES.has(lead.stage)) return "lost";

  const touch = lastTouchDays(lead, now);
  const aging = stageAgingDays(lead, now);
  const fuDue = lead.nextFollowUpAt
    ? toDate(lead.nextFollowUpAt)!.getTime() - now.getTime()
    : null;

  // HOT — late-funnel stage with any recent activity, OR upcoming follow-up <48h
  if (HOT_STAGES.has(lead.stage) && (touch == null || touch <= 7)) return "hot";
  if (fuDue != null && fuDue > 0 && fuDue <= 48 * 3600 * 1000) return "hot";

  // COLD — no touch in 30 days, or stuck >14 days in current stage
  if ((touch != null && touch > 30) || (aging != null && aging > 14)) return "cold";

  // WARM — default for active mid-funnel leads
  if (MID_STAGES.has(lead.stage) || lead.stage === "new") return "warm";

  // Fallback
  return touch != null && touch <= 14 ? "warm" : "cold";
}

/**
 * Per-stage win-probability weights (MFD-typical funnel). Late funnel scores
 * higher. Mirrors the weights used in the pipeline-forecast section.
 */
const STAGE_SCORE: Record<string, number> = {
  new: 8,
  call_not_connected: 8,
  contact_in_future: 10,
  call_back_later: 14,
  contacted: 16,
  call_done: 18,
  follow_up: 18,
  meeting_pending: 22,
  meeting_scheduled: 30,
  appointment_scheduled: 30,
  qualified: 32,
  meeting_done: 38,
  risk_profile_sent: 40,
  risk_profiled: 42,
  proposal_drafted: 40,
  proposal_shared: 44,
  proposal_approved: 48,
  docs_requested: 46,
  docs_received: 50,
  won_lead: 50,
  post_meeting_qualified: 46,
};

/**
 * Deterministic lead priority score (0–100). No AI, no DB — computable for
 * every lead in a list so the desk can sort "hottest first".
 *
 * Blend (max 100):
 *   - Stage (funnel depth)         up to 50
 *   - Recency of contact           up to 20
 *   - Follow-up discipline         up to 15  (scheduled & not overdue = good)
 *   - Intended investment size     up to 15  (₹10L+ = full)
 * Terminal lost stages score 0.
 */
/**
 * @deprecated Prefer the persisted `leads.lead_score` column (written by the
 * canonical engine in ./score on create + every stage transition, backfilled
 * by scripts/backfill-lead-scores.ts). This wrapper now delegates to that same
 * engine so any remaining caller gets the identical number — there is exactly
 * one scoring algorithm. Reading the persisted column avoids recomputing on
 * every render and scales to large pipelines.
 */
export function leadScore(lead: LeadForScoring, now = new Date()): number {
  return scoreLead(lead as any, now.getTime()).score;
}

/** Band + colour for a numeric lead score, for chips/dots. */
export function leadScoreBand(score: number): { label: string; chip: string; dot: string } {
  if (score >= 70) return { label: "Hot", chip: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
  if (score >= 45) return { label: "Warm", chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
  return { label: "Cold", chip: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" };
}

/**
 * Parse the (text) intended_amount field into a number, tolerating
 * commas, ₹ symbols, "Lakh"/"Cr" suffixes and stray whitespace.
 * Returns 0 if it can't make sense of the input.
 */
export function parseIntendedAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = String(raw).trim().toLowerCase().replace(/[₹,\s]/g, "");
  if (!s) return 0;
  // L / lakh / lac
  if (/(\d+(?:\.\d+)?)\s*(l|lac|lakh)/.test(s)) {
    const m = s.match(/(\d+(?:\.\d+)?)\s*(l|lac|lakh)/);
    if (m) return Math.round(parseFloat(m[1]) * 100_000);
  }
  // Cr / crore
  if (/(\d+(?:\.\d+)?)\s*(cr|crore)/.test(s)) {
    const m = s.match(/(\d+(?:\.\d+)?)\s*(cr|crore)/);
    if (m) return Math.round(parseFloat(m[1]) * 10_000_000);
  }
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

/**
 * Tiny tone-color helper so multiple components stay visually consistent.
 */
export function temperatureClasses(t: LeadTemperature) {
  switch (t) {
    case "hot":
      return {
        chip: "bg-rose-50 text-rose-700 border-rose-200",
        dot: "bg-rose-500",
        label: "Hot",
      };
    case "warm":
      return {
        chip: "bg-amber-50 text-amber-700 border-amber-200",
        dot: "bg-amber-500",
        label: "Warm",
      };
    case "cold":
      return {
        chip: "bg-sky-50 text-sky-700 border-sky-200",
        dot: "bg-sky-500",
        label: "Cold",
      };
    case "lost":
      return {
        chip: "bg-slate-50 text-slate-600 border-slate-200",
        dot: "bg-slate-400",
        label: "Lost",
      };
  }
}
