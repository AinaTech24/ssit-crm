/**
 * Default MF Suitability Matrix cells — adopted from Network FP "3.2 MF
 * Suitability Matrix".
 *
 * The 3×3 grid (risk profile × time horizon) ships blank today; a new firm
 * has to invent the mapping themselves. These are sensible, IC-defensible
 * starting defaults a firm can prefill and then tweak.
 *
 * `coarseCategories` uses the same vocabulary as the matrix editor
 * (equity / hybrid / debt / liquid / international / commodity / other).
 * `allocationHints` is an indicative %-split (sums to ~100) the proposal
 * flow can lift as a starting allocation.
 *
 * Pure data — no DB, no network.
 */

export type RiskProfile = "low" | "moderate" | "high";
export type TimeHorizon = "short" | "medium" | "long";

export type SuitabilityDefault = {
  riskProfile: RiskProfile;
  timeHorizon: TimeHorizon;
  coarseCategories: string[];
  allocationHints: Record<string, number>;
  notes: string;
};

export const SUITABILITY_DEFAULTS: SuitabilityDefault[] = [
  // ---------------- LOW RISK ----------------
  {
    riskProfile: "low",
    timeHorizon: "short",
    coarseCategories: ["liquid", "debt"],
    allocationHints: { liquid: 70, debt: 30 },
    notes:
      "Capital preservation + liquidity. Liquid / overnight funds with a small short-duration debt sleeve. Park money, beat savings account, stay accessible.",
  },
  {
    riskProfile: "low",
    timeHorizon: "medium",
    coarseCategories: ["debt", "liquid"],
    allocationHints: { debt: 75, liquid: 25 },
    notes:
      "Short-to-medium duration debt for 1–3 year goals; small liquid buffer. AAA/sovereign quality only.",
  },
  {
    riskProfile: "low",
    timeHorizon: "long",
    coarseCategories: ["debt", "hybrid"],
    allocationHints: { debt: 70, hybrid: 30 },
    notes:
      "Long-duration / dynamic-bond debt core with a conservative-hybrid (or BAF) sleeve to gently beat inflation without exposing the client to equity volatility they can't stomach.",
  },

  // ---------------- MODERATE RISK ----------------
  {
    riskProfile: "moderate",
    timeHorizon: "short",
    coarseCategories: ["debt", "liquid"],
    allocationHints: { debt: 60, liquid: 40 },
    notes:
      "Even a moderate-risk client should stay debt/liquid heavy on a <1yr horizon — there isn't time to ride out an equity drawdown.",
  },
  {
    riskProfile: "moderate",
    timeHorizon: "medium",
    coarseCategories: ["hybrid", "debt"],
    allocationHints: { hybrid: 55, debt: 45 },
    notes:
      "Balanced-advantage / aggressive-hybrid core for 1–3 years, balanced by quality debt. Lets the client participate in equity upside with managed downside.",
  },
  {
    riskProfile: "moderate",
    timeHorizon: "long",
    coarseCategories: ["equity", "hybrid", "debt"],
    allocationHints: { equity: 55, hybrid: 25, debt: 20 },
    notes:
      "Large-cap / flexi-cap equity core, hybrid for stability, debt tail. The classic long-term moderate allocation.",
  },

  // ---------------- HIGH RISK ----------------
  {
    riskProfile: "high",
    timeHorizon: "short",
    coarseCategories: ["hybrid", "debt"],
    allocationHints: { hybrid: 60, debt: 40 },
    notes:
      "Risk appetite is high but the horizon is short — cap equity via balanced-advantage rather than pure equity. Educate the client that <1yr equity is speculation, not investing.",
  },
  {
    riskProfile: "high",
    timeHorizon: "medium",
    coarseCategories: ["equity", "hybrid"],
    allocationHints: { equity: 65, hybrid: 35 },
    notes:
      "Flexi-cap + some mid-cap equity, cushioned by aggressive hybrid. 1–3 years can absorb moderate equity volatility.",
  },
  {
    riskProfile: "high",
    timeHorizon: "long",
    coarseCategories: ["equity", "international"],
    allocationHints: { equity: 85, international: 15 },
    notes:
      "Maximise long-term compounding — flexi/mid/small-cap equity core with an international diversifier. Pair with a goal review so the client doesn't panic-redeem in a correction.",
  },
];

/** Lookup a single default cell. */
export function getSuitabilityDefault(
  risk: RiskProfile,
  horizon: TimeHorizon
): SuitabilityDefault | undefined {
  return SUITABILITY_DEFAULTS.find(
    (d) => d.riskProfile === risk && d.timeHorizon === horizon
  );
}
