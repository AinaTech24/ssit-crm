/**
 * Capital Gains Tax — math engine (assets purchased before / after FY 2001-02).
 *
 * Long-term gains use indexation against the Cost Inflation Index (CII, base
 * FY2001-02 = 100): indexed cost = cost × CII(saleFY) / CII(costFY). Short-term
 * gains use the actual cost (no indexation) and are taxed at the assessee's
 * slab. Verified to the reference case (house: buy ₹15L FY2004-05, improve ₹5L
 * FY2010-11, sell ₹70L less ₹1L expenses FY2022-23 → indexed acquisition
 * ₹43,93,805, indexed improvement ₹9,91,018, LTCG ₹15,15,177, tax @20%
 * ₹3,03,035, +4% cess ₹3,15,157).
 */

/** Official Cost Inflation Index, keyed by FY start year (FY2001-02 → 2001). */
export const CII: Record<number, number> = {
  2001: 100, 2002: 105, 2003: 109, 2004: 113, 2005: 117, 2006: 122, 2007: 129,
  2008: 137, 2009: 148, 2010: 167, 2011: 184, 2012: 200, 2013: 220, 2014: 240,
  2015: 254, 2016: 264, 2017: 272, 2018: 280, 2019: 289, 2020: 301, 2021: 317,
  2022: 331, 2023: 348, 2024: 363,
};

export const CII_BASE_YEAR = 2001;
export const LTCG_RATE_PCT = 20; // with indexation
export const CESS_PCT = 4; // health & education cess

export type AssetType = "immovable" | "movable" | "gold" | "unlisted_shares" | "other";
export type AcquisitionBasis = "after_2001" | "before_2001";

/**
 * Months threshold for long-term classification, by asset type.
 * Budget 2024 (w.e.f. 23-Jul-2024) abolished the 36-month bucket: listed
 * securities qualify as long-term at 12 months, every OTHER asset at 24 months.
 */
export const LT_THRESHOLD_MONTHS: Record<AssetType, number> = {
  immovable: 24,
  unlisted_shares: 24,
  movable: 24,
  gold: 24,
  other: 24,
};

/** FY start year for an ISO date (India FY = 1 Apr–31 Mar). */
export function fyStartYear(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  return m >= 4 ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  const next = (startYear + 1) % 100;
  return `${startYear}-${String(next).padStart(2, "0")}`;
}

/** CII for an FY start year (pre-2001 falls back to the base year). */
export function ciiFor(startYear: number): number {
  if (startYear <= CII_BASE_YEAR) return CII[CII_BASE_YEAR];
  return CII[startYear] ?? CII[Math.max(...Object.keys(CII).map(Number))];
}

/** Whole months between two ISO dates. */
export function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso);
  const b = new Date(bIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

export type Improvement = { fyStartYear: number; cost: number };

export type CapitalGainsInput = {
  acquisitionBasis: AcquisitionBasis;
  assetType: AssetType;
  purchasePrice: number;
  purchaseDate: string; // ISO
  fmv2001: number; // FMV as on 01/04/2001 (before_2001 basis)
  improvements: Improvement[];
  salePrice: number;
  salesExpenses: number;
  saleDate: string; // ISO
  expectedSaleCII: number | null; // override for the sale year's CII
  incomeTaxSlabPct: number; // for short-term gains
};

export type CapitalGainsResult = {
  holdingMonths: number;
  isLongTerm: boolean;
  saleFY: number | null;
  purchaseFY: number | null;
  ciiSale: number;
  netConsideration: number;
  costBase: number; // purchase price or FMV (before_2001)
  indexedAcquisition: number;
  indexedImprovements: number;
  totalImprovementsRaw: number;
  gain: number;
  baseTax: number;
  cess: number;
  totalTax: number;
  effectiveRatePct: number;
};

export function computeCapitalGains(input: CapitalGainsInput): CapitalGainsResult {
  const purchaseFY = fyStartYear(input.purchaseDate);
  const saleFY = fyStartYear(input.saleDate);
  const holdingMonths = monthsBetween(input.purchaseDate, input.saleDate);
  const threshold = LT_THRESHOLD_MONTHS[input.assetType];
  const isLongTerm = holdingMonths >= threshold;

  const ciiSale = input.expectedSaleCII && input.expectedSaleCII > 0
    ? input.expectedSaleCII
    : ciiFor(saleFY ?? CII_BASE_YEAR);

  const netConsideration = Math.max(0, input.salePrice - input.salesExpenses);

  // Cost base: before-2001 assets use the higher of actual cost and FMV-2001.
  const costBase =
    input.acquisitionBasis === "before_2001"
      ? Math.max(input.purchasePrice, input.fmv2001)
      : input.purchasePrice;
  const costFY = input.acquisitionBasis === "before_2001" ? CII_BASE_YEAR : purchaseFY ?? CII_BASE_YEAR;

  const totalImprovementsRaw = input.improvements.reduce((s, im) => s + (im.cost || 0), 0);

  let indexedAcquisition: number;
  let indexedImprovements: number;
  let gain: number;
  let baseTax: number;

  if (isLongTerm) {
    indexedAcquisition = (costBase * ciiSale) / ciiFor(costFY);
    indexedImprovements = input.improvements.reduce(
      (s, im) => s + (im.cost * ciiSale) / ciiFor(im.fyStartYear),
      0
    );
    gain = netConsideration - indexedAcquisition - indexedImprovements;
    baseTax = Math.max(0, gain) * (LTCG_RATE_PCT / 100);
  } else {
    indexedAcquisition = costBase; // no indexation
    indexedImprovements = totalImprovementsRaw;
    gain = netConsideration - costBase - totalImprovementsRaw;
    baseTax = Math.max(0, gain) * (input.incomeTaxSlabPct / 100);
  }

  const cess = baseTax * (CESS_PCT / 100);
  const totalTax = baseTax + cess;

  return {
    holdingMonths,
    isLongTerm,
    saleFY,
    purchaseFY,
    ciiSale,
    netConsideration,
    costBase,
    indexedAcquisition,
    indexedImprovements,
    totalImprovementsRaw,
    gain,
    baseTax,
    cess,
    totalTax,
    effectiveRatePct: gain > 0 ? (totalTax / gain) * 100 : 0,
  };
}
