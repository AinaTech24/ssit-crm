/**
 * Service-tier helpers.
 *
 * Tier rules (auto, unless manually overridden):
 *   A = top 20% by AUM in this tenant, or HNI segment, or NRI HNI
 *   B = next 30%, or Affluent segment
 *   C = remaining 50% retail
 *
 * Cadence (in days):
 *   A → 90 (quarterly)
 *   B → 180 (half-yearly)
 *   C → 365 (annual)
 *
 * Used by:
 *   - tier-recomputer worker (nightly recompute per tenant)
 *   - review-meeting recipe (next_review_at calculation when meeting is logged)
 */

export type ServiceTier = "A" | "B" | "C";

export const TIER_CADENCE_DAYS: Record<ServiceTier, number> = {
  A: 90,
  B: 180,
  C: 365,
};

export const TIER_LABELS: Record<ServiceTier, string> = {
  A: "Tier A · Premium (quarterly review)",
  B: "Tier B · Standard (half-yearly review)",
  C: "Tier C · Long tail (annual)",
};

export const TIER_COLORS: Record<ServiceTier, string> = {
  A: "bg-violet-50 text-violet-700",
  B: "bg-emerald-50 text-emerald-700",
  C: "bg-blue-50 text-blue-700",
};

/**
 * Decide tier based on rules. Pass the investor + the tenant's AUM percentile
 * cut-offs (computed once per tenant per night).
 */
export function decideTier(opts: {
  aum: number;
  segmentTag?: string | null;
  isManualOverride?: boolean;
  currentTier?: ServiceTier | null;
  p80AumCutoff: number; // AUM value at the 80th percentile in this tenant
  p50AumCutoff: number;
}): ServiceTier {
  if (opts.isManualOverride && opts.currentTier) return opts.currentTier;
  // Segment-based shortcuts first
  if (opts.segmentTag === "HNI") return "A";
  if (opts.segmentTag === "NRI" && opts.aum >= opts.p80AumCutoff) return "A";
  if (opts.segmentTag === "Affluent") return "B";

  // AUM-based percentile assignment
  if (opts.aum >= opts.p80AumCutoff) return "A";
  if (opts.aum >= opts.p50AumCutoff) return "B";
  return "C";
}

/** Compute the next_review_at from now based on tier. */
export function nextReviewDateFor(tier: ServiceTier, from: Date = new Date()): Date {
  const days = TIER_CADENCE_DAYS[tier];
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
