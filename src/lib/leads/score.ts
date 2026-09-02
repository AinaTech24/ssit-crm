/**
 * Deterministic lead-scoring engine — a transparent, explainable scorecard.
 *
 * This is NOT an LLM call. It is a weighted, rule-based model that maps the
 * hard signals on a lead row to a 0–100 score, a band (hot/warm/cold), and a
 * list of the factors that produced that score. Because every contribution is
 * named, an RM can see *why* a lead is hot — and we can defend the ranking to
 * a compliance reviewer.
 *
 * The AI lead-score endpoint (`/api/ai/lead-score`) remains an advisory,
 * narrative layer on top; THIS is the number that gets persisted, sorted on,
 * and used to drive "hottest leads first" + automation hooks.
 *
 * Signals (all sourced from the `leads` row — no joins required):
 *   • source        channel quality (referral/existing-client convert best)
 *   • stage         funnel progression (further along ⇒ closer to conversion)
 *   • recency       days since last contact (warm leads decay fast)
 *   • momentum      a future follow-up scheduled = active deal
 *   • value         intended investment amount (bigger ticket ⇒ prioritise)
 *   • freshness     stale-in-stage penalty (stuck deals lose heat)
 *   • completeness  PAN/email/phone present = a real, contactable lead
 *
 * Terminal-negative stages (lost / not-interested / not-qualified / cold) are
 * dead: they floor the score and force the `cold` band regardless of signals.
 */

export type ScoreBand = "hot" | "warm" | "cold";

export interface LeadScoreFactor {
  /** Stable key for the contributing signal. */
  key: string;
  /** Human-readable explanation shown in the UI. */
  label: string;
  /** Signed point contribution (can be negative). */
  points: number;
}

export interface LeadScoreResult {
  /** Final clamped score, 0–100. */
  score: number;
  /** Band derived from the score (and terminal stages). */
  band: ScoreBand;
  /** Ordered list of contributions (largest magnitude first). */
  factors: LeadScoreFactor[];
}

/** The subset of a lead row the scorer reads. Loosely typed so callers can
 *  pass a full `Lead` row or a partial without fighting the type system. */
export interface ScorableLead {
  source?: string | null;
  stage?: string | null;
  intendedAmount?: string | number | null;
  lastContactAt?: Date | string | null;
  nextFollowUpAt?: Date | string | null;
  stageChangedAt?: Date | string | null;
  createdAt?: Date | string | null;
  email?: string | null;
  phone?: string | null;
  pan?: string | null;
  interestProducts?: string[] | null;
}

const BASE = 25;

// ── Source quality ──────────────────────────────────────────────────────────
// Referrals & existing-client references convert dramatically better than cold
// inbound; paid/cold channels are the floor.
const SOURCE_POINTS: Record<string, number> = {
  referral: 20,
  existing_client: 20,
  seminar: 14,
  webinar: 13,
  website: 11,
  walk_in: 11,
  event: 10,
  social_media: 7,
  linkedin: 7,
  youtube: 6,
  google: 6,
  meta_ads: 5,
  google_ads: 5,
  cold_call: 2,
  manual: 4,
  other: 4,
};

// ── Stage progression ───────────────────────────────────────────────────────
// A rank 0–10 of how deep into the funnel a stage is. Higher = closer to (or
// at) conversion ⇒ a hotter, higher-intent lead. Terminal-negative stages are
// handled separately (they floor the score), so they're omitted here.
const STAGE_RANK: Record<string, number> = {
  new: 0,
  call_not_connected: 1,
  contacted: 2,
  call_done: 2,
  call_back_later: 2,
  contact_in_future: 1,
  follow_up: 3,
  qualified: 4,
  meeting_pending: 4,
  meeting_scheduled: 5,
  meeting_done: 6,
  risk_profile_sent: 6,
  risk_profiled: 7,
  proposal_drafted: 7,
  proposal_sent: 8,
  proposal_shared: 8,
  proposal_approved: 9,
  docs_requested: 9,
  request_documents: 9,
  documents_pending: 9,
  docs_received: 10,
  documents_received: 10,
  won_lead: 10,
  // Onboarding/ops stages mean the lead already converted — treat as max heat
  // until they're moved out of the leads board into clients.
  kyc_pending: 10,
  kyc_validated: 10,
  kyc_registered: 10,
  ucc_create: 10,
  ucc_activated: 10,
  mandate_create: 10,
  mandate_activated: 10,
  make_transaction: 10,
  transaction_successful: 10,
  converted: 10,
};

const TERMINAL_NEGATIVE = new Set([
  "lost",
  "not_interested",
  "not_qualified",
  "cold",
  "mandate_reject",
  "mandate_rejected",
  "transaction_failed",
]);

const DAY_MS = 86_400_000;

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysSince(v: Date | string | null | undefined, now: number): number | null {
  const d = toDate(v);
  if (!d) return null;
  return Math.floor((now - d.getTime()) / DAY_MS);
}

/** Parse the free-text intendedAmount into a number of rupees (best effort). */
export function parseIntendedAmount(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = v.toLowerCase().replace(/[,₹\s]/g, "");
  // Match a leading number, optionally followed by a lakh/crore/k suffix.
  const m = s.match(/([\d.]+)\s*(cr|crore|l|lac|lakh|k|thousand)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  switch (m[2]) {
    case "cr":
    case "crore":
      return n * 1_00_00_000;
    case "l":
    case "lac":
    case "lakh":
      return n * 1_00_000;
    case "k":
    case "thousand":
      return n * 1_000;
    default:
      return n;
  }
}

function bandFor(score: number): ScoreBand {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

/**
 * Score a lead. Pure function of the row + the current time (injectable for
 * deterministic tests / backfills).
 */
export function scoreLead(lead: ScorableLead, now: number = Date.now()): LeadScoreResult {
  const factors: LeadScoreFactor[] = [];
  const stage = (lead.stage ?? "").toLowerCase();

  // Terminal-negative short-circuit — a dead lead is cold, full stop.
  if (TERMINAL_NEGATIVE.has(stage)) {
    return {
      score: 5,
      band: "cold",
      factors: [
        { key: "terminal", label: `Stage "${stage.replace(/_/g, " ")}" — closed/lost`, points: 5 },
      ],
    };
  }

  factors.push({ key: "base", label: "Base score", points: BASE });

  // Source quality
  const src = (lead.source ?? "").toLowerCase();
  const srcPts = SOURCE_POINTS[src] ?? 4;
  if (srcPts) {
    factors.push({
      key: "source",
      label: `Source: ${src ? src.replace(/_/g, " ") : "unknown"}`,
      points: srcPts,
    });
  }

  // Stage progression — rank 0–10 scaled ×3 (max +30)
  const rank = STAGE_RANK[stage] ?? 0;
  if (rank > 0) {
    factors.push({
      key: "stage",
      label: `Funnel stage: ${stage.replace(/_/g, " ")}`,
      points: rank * 3,
    });
  }

  // Recency of contact — warm leads decay; cold contact is a real penalty
  const sinceContact = daysSince(lead.lastContactAt, now);
  if (sinceContact === null) {
    factors.push({ key: "recency", label: "Never contacted", points: -6 });
  } else if (sinceContact <= 3) {
    factors.push({ key: "recency", label: "Contacted in last 3 days", points: 16 });
  } else if (sinceContact <= 7) {
    factors.push({ key: "recency", label: "Contacted this week", points: 11 });
  } else if (sinceContact <= 30) {
    factors.push({ key: "recency", label: "Contacted this month", points: 5 });
  } else if (sinceContact <= 60) {
    factors.push({ key: "recency", label: "No contact in 30+ days", points: -4 });
  } else {
    factors.push({ key: "recency", label: "No contact in 60+ days", points: -10 });
  }

  // Momentum — a future follow-up scheduled = an active, worked deal
  const fu = toDate(lead.nextFollowUpAt);
  if (fu && fu.getTime() >= now - DAY_MS) {
    factors.push({ key: "momentum", label: "Follow-up scheduled", points: 8 });
  }

  // Deal value — bigger ticket, higher priority
  const amount = parseIntendedAmount(lead.intendedAmount ?? null);
  if (amount >= 1_00_00_000) {
    factors.push({ key: "value", label: "Intended ₹1Cr+", points: 14 });
  } else if (amount >= 25_00_000) {
    factors.push({ key: "value", label: "Intended ₹25L+", points: 11 });
  } else if (amount >= 10_00_000) {
    factors.push({ key: "value", label: "Intended ₹10L+", points: 8 });
  } else if (amount >= 5_00_000) {
    factors.push({ key: "value", label: "Intended ₹5L+", points: 5 });
  } else if (amount >= 1_00_000) {
    factors.push({ key: "value", label: "Intended ₹1L+", points: 3 });
  }

  // Freshness — a deal stuck in the same stage loses heat
  const stuck = daysSince(lead.stageChangedAt, now);
  if (stuck !== null && rank > 0 && rank < 10) {
    if (stuck >= 45) {
      factors.push({ key: "stall", label: "Stuck in stage 45+ days", points: -12 });
    } else if (stuck >= 21) {
      factors.push({ key: "stall", label: "Stuck in stage 21+ days", points: -6 });
    }
  }

  // Data completeness — a contactable, identified lead is more actionable
  let complete = 0;
  if (lead.phone) complete++;
  if (lead.email) complete++;
  if (lead.pan) complete++;
  if (complete >= 3) {
    factors.push({ key: "complete", label: "PAN + phone + email on file", points: 6 });
  } else if (complete === 2) {
    factors.push({ key: "complete", label: "Two contact identifiers on file", points: 3 });
  } else if (complete === 0) {
    factors.push({ key: "complete", label: "No contact identifiers", points: -5 });
  }

  // Engagement depth — known product interest signals intent
  if (lead.interestProducts && lead.interestProducts.length > 0) {
    factors.push({ key: "interest", label: "Product interest captured", points: 4 });
  }

  const raw = factors.reduce((s, f) => s + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // Order by magnitude so the UI can show the top drivers first.
  factors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return { score, band: bandFor(score), factors };
}

/**
 * Convenience: produce the persistable columns for a lead row. Spread into a
 * Drizzle insert/update `.values({...})` / `.set({...})`.
 */
export function scoreFields(lead: ScorableLead, now: number = Date.now()): {
  leadScore: number;
  scoreBand: ScoreBand;
  scoredAt: Date;
} {
  const { score, band } = scoreLead(lead, now);
  return { leadScore: score, scoreBand: band, scoredAt: new Date(now) };
}

/** Tailwind chip class for a score band — matches the stage palette. */
export function bandBadgeClass(band: ScoreBand): string {
  switch (band) {
    case "hot":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "warm":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

/** Short emoji+label for a band (used on compact chips). */
export function bandLabel(band: ScoreBand): string {
  switch (band) {
    case "hot":
      return "Hot";
    case "warm":
      return "Warm";
    default:
      return "Cold";
  }
}
