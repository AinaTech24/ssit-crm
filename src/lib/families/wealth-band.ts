/**
 * Family wealth-band tiering (Sanchay "Family Category" parity).
 *
 * Classifies a family by its combined active-member AUM into the standard
 * Indian wealth tiers. Used for the counted status chips + band badge on the
 * Families list. Pure thresholds — no stored column, computed from member AUM.
 */

export const WEALTH_BANDS = ["super_hni", "hni", "upper_middle", "middle", "empty"] as const;
export type WealthBand = (typeof WEALTH_BANDS)[number];

export const WEALTH_BAND_META: Record<WealthBand, { label: string; tone: "violet" | "emerald" | "sky" | "amber" | "slate"; min: number }> = {
  super_hni: { label: "Super HNI", tone: "violet", min: 50_000_000 }, // ≥ ₹5 Cr
  hni: { label: "HNI", tone: "emerald", min: 10_000_000 }, // ≥ ₹1 Cr
  upper_middle: { label: "Upper Middle", tone: "sky", min: 2_500_000 }, // ≥ ₹25 L
  middle: { label: "Middle", tone: "amber", min: 1 }, // > ₹0
  empty: { label: "Empty", tone: "slate", min: 0 }, // no AUM
};

export function wealthBand(aum: number): WealthBand {
  const a = Number(aum) || 0;
  if (a >= WEALTH_BAND_META.super_hni.min) return "super_hni";
  if (a >= WEALTH_BAND_META.hni.min) return "hni";
  if (a >= WEALTH_BAND_META.upper_middle.min) return "upper_middle";
  if (a >= WEALTH_BAND_META.middle.min) return "middle";
  return "empty";
}

/** SQL CASE expression that maps a numeric AUM column to its band key. */
export function bandCaseSql(aumExpr: string): string {
  return `CASE
    WHEN ${aumExpr} >= ${WEALTH_BAND_META.super_hni.min} THEN 'super_hni'
    WHEN ${aumExpr} >= ${WEALTH_BAND_META.hni.min} THEN 'hni'
    WHEN ${aumExpr} >= ${WEALTH_BAND_META.upper_middle.min} THEN 'upper_middle'
    WHEN ${aumExpr} > 0 THEN 'middle'
    ELSE 'empty' END`;
}

/** Inclusive lower / exclusive upper AUM bounds for a band (for HAVING filters). */
export function bandBounds(band: WealthBand): { min: number; max: number | null } {
  switch (band) {
    case "super_hni": return { min: 50_000_000, max: null };
    case "hni": return { min: 10_000_000, max: 50_000_000 };
    case "upper_middle": return { min: 2_500_000, max: 10_000_000 };
    case "middle": return { min: 1, max: 2_500_000 };
    case "empty": return { min: 0, max: 1 };
  }
}
