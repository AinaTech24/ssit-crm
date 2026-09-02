/**
 * Risk-profile ↔ portfolio suitability. Compares a client's actual equity
 * exposure against the comfort band implied by their signed risk profile and
 * flags a material mismatch (the kind a reviewer / SEBI audit cares about).
 *
 * The bands are advisory rules-of-thumb, not regulation — tune per firm later.
 */

export type RiskProfile = "conservative" | "moderate" | "aggressive" | "very_aggressive";

/** Comfortable equity-exposure ceiling (and a soft floor) per risk profile, %. */
const BANDS: Record<RiskProfile, { floor: number; ceiling: number }> = {
  conservative: { floor: 0, ceiling: 30 },
  moderate: { floor: 20, ceiling: 60 },
  aggressive: { floor: 50, ceiling: 85 },
  very_aggressive: { floor: 70, ceiling: 100 },
};

export type Suitability = {
  severity: "ok" | "warn" | "breach" | "unknown";
  message: string;
  equityPct: number | null;
  profile: RiskProfile | null;
  band: { floor: number; ceiling: number } | null;
};

export function assessSuitability(
  riskProfile: string | null | undefined,
  equityPct: number | null,
  classifiedPct: number
): Suitability {
  const profile = (riskProfile ?? "") as RiskProfile;
  const band = BANDS[profile] ?? null;

  if (!band) {
    return { severity: "unknown", message: "No signed risk profile on file — capture one to enable suitability checks.", equityPct, profile: null, band: null };
  }
  if (equityPct == null || classifiedPct < 25) {
    return { severity: "unknown", message: "Not enough classified holdings to assess suitability yet.", equityPct, profile, band };
  }

  const e = Math.round(equityPct);
  // Over-exposed to equity for the profile = the risk that matters most.
  if (e > band.ceiling + 10) {
    return { severity: "breach", message: `Equity exposure ${e}% is well above the ${profile.replace("_", " ")} ceiling (~${band.ceiling}%). Rebalance or re-profile.`, equityPct, profile, band };
  }
  if (e > band.ceiling) {
    return { severity: "warn", message: `Equity exposure ${e}% slightly exceeds the ${profile.replace("_", " ")} ceiling (~${band.ceiling}%).`, equityPct, profile, band };
  }
  // Materially under-invested in equity vs an aggressive mandate is also a flag.
  if (e < band.floor - 10) {
    return { severity: "warn", message: `Equity exposure ${e}% is below the ${profile.replace("_", " ")} floor (~${band.floor}%) — under-utilising the mandate.`, equityPct, profile, band };
  }
  return { severity: "ok", message: `Equity exposure ${e}% sits within the ${profile.replace("_", " ")} band (${band.floor}–${band.ceiling}%).`, equityPct, profile, band };
}
