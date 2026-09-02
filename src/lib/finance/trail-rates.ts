/**
 * Trail-rate reference data — the single source of truth for "what trail %
 * does this scheme category earn" across the whole app.
 *
 * Consumed by:
 *   - the brokerage reconciler (expected vs received)        — commission/reconciler.ts
 *   - the trail-income forecast + revenue-at-risk dashboard  — finance/trail-forecast.ts
 *
 * These are CONSERVATIVE category fallbacks. Each MFD overrides them per-AMC
 * with the real negotiated rate via the empanelment register
 * (amc_empanelments.trail_rate_override_pct), which always wins when present.
 */

/** Category → annual trail rate (as a fraction, e.g. 0.0085 = 0.85% p.a.). */
export const FALLBACK_TRAIL: Record<string, number> = {
  equity: 0.0085,
  hybrid: 0.005,
  debt: 0.003,
  liquid: 0.0008,
  elss: 0.0095,
  default: 0.0065,
};

/**
 * Resolve the annual trail rate (fraction) for a scheme category string.
 * Matches the most specific tag contained in the category label; falls back
 * to the conservative default. NOTE: `elss` is checked before `equity` so an
 * "ELSS / equity-linked" label resolves to the higher ELSS rate.
 */
export function trailRate(category?: string | null): number {
  if (!category) return FALLBACK_TRAIL.default;
  const k = category.toLowerCase();
  // Most-specific first.
  if (k.includes("elss") || k.includes("tax saver") || k.includes("tax-saver")) return FALLBACK_TRAIL.elss;
  if (k.includes("liquid") || k.includes("overnight") || k.includes("money market")) return FALLBACK_TRAIL.liquid;
  if (k.includes("hybrid") || k.includes("balanced") || k.includes("multi asset") || k.includes("multi-asset"))
    return FALLBACK_TRAIL.hybrid;
  if (k.includes("debt") || k.includes("bond") || k.includes("gilt") || k.includes("duration"))
    return FALLBACK_TRAIL.debt;
  if (k.includes("equity") || k.includes("flexi") || k.includes("large") || k.includes("mid") || k.includes("small") || k.includes("index"))
    return FALLBACK_TRAIL.equity;
  return FALLBACK_TRAIL.default;
}

/** SIP frequency → number of installments per year. */
export const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  weekly: 52,
  fortnightly: 26,
  yearly: 1,
};

/** Annualised contribution of a SIP (installment amount × installments/year). */
export function sipAnnualAmount(amount: number, frequency?: string | null): number {
  const n = PERIODS_PER_YEAR[(frequency ?? "monthly").toLowerCase()] ?? 12;
  return amount * n;
}
