/**
 * Asset Allocation Review — "Existing vs Suggested" portfolio report.
 *
 * Faithful to the advisor worksheet it's modelled on: 12 product sleeves, each
 * with an invested amount + assumed annual return, projected to two horizons
 * (default 5y & 10y). Lumpsum sleeves compound annually; the dedicated "SIP"
 * sleeve is a monthly contribution grown as an annuity-due (begin-of-month),
 * matching Excel `FV(rate/12, years*12, -sip, , 1)`. The SIP amount is excluded
 * from the "gross corpus" total (it's a monthly flow, not a lump), exactly like
 * the worksheet's `SUM(D4:D15) - D8`.
 *
 * Improvements over the raw sheet: an Existing-vs-Suggested uplift, a risk-bucket
 * asset-mix rollup (the real "asset allocation" view), a blended-return figure
 * and a year-by-year growth series for charting.
 */

export type AssetKind = "lumpsum" | "monthly";
export type AssetBucket = "Equity" | "Debt" | "Gold" | "Alternatives" | "Cash" | "Real Estate";

export type AllocClassDef = {
  key: string;
  label: string;
  kind: AssetKind;
  bucket: AssetBucket;
  defaultReturnPct: number;
};

/** The 12 sleeves, in worksheet order, with the worksheet's default returns. */
export const ALLOC_CLASSES: AllocClassDef[] = [
  { key: "ppf", label: "PPF / Post Office", kind: "lumpsum", bucket: "Debt", defaultReturnPct: 7 },
  { key: "gold", label: "Gold / ETF", kind: "lumpsum", bucket: "Gold", defaultReturnPct: 9 },
  { key: "debt", label: "Debt Fund / FD", kind: "lumpsum", bucket: "Debt", defaultReturnPct: 6 },
  { key: "mf", label: "MF (Lumpsum)", kind: "lumpsum", bucket: "Equity", defaultReturnPct: 12 },
  { key: "sip", label: "SIP (monthly)", kind: "monthly", bucket: "Equity", defaultReturnPct: 12 },
  { key: "pms", label: "PMS + AIF + Model Portfolio", kind: "lumpsum", bucket: "Alternatives", defaultReturnPct: 12 },
  { key: "liquid", label: "Liquid / Savings A/c", kind: "lumpsum", bucket: "Cash", defaultReturnPct: 4 },
  { key: "intl", label: "International Funds", kind: "lumpsum", bucket: "Equity", defaultReturnPct: 12 },
  { key: "pe", label: "Private Equity", kind: "lumpsum", bucket: "Alternatives", defaultReturnPct: 20 },
  { key: "eqlt", label: "Equity — Long term", kind: "lumpsum", bucket: "Equity", defaultReturnPct: 12 },
  { key: "eqst", label: "Equity — Short term", kind: "lumpsum", bucket: "Equity", defaultReturnPct: 8 },
  { key: "realestate", label: "Real Estate", kind: "lumpsum", bucket: "Real Estate", defaultReturnPct: 8 },
];

export const ASSET_BUCKETS: AssetBucket[] = ["Equity", "Debt", "Gold", "Alternatives", "Real Estate", "Cash"];

export type AllocRow = { amount: number; returnPct: number };

export type AllocInput = {
  horizonA: number; // e.g. 5
  horizonB: number; // e.g. 10
  /** Per-sleeve figures, aligned to ALLOC_CLASSES order. */
  rows: AllocRow[];
};

export type SleeveResult = {
  key: string;
  label: string;
  kind: AssetKind;
  bucket: AssetBucket;
  amount: number;
  returnPct: number;
  /** Share of the lumpsum corpus (SIP sleeves have no corpus share → 0). */
  allocationPct: number;
  fvA: number;
  fvB: number;
};

export type BucketShare = { bucket: AssetBucket; amount: number; pct: number };

export type PortfolioResult = {
  sleeves: SleeveResult[];
  lumpsumCorpus: number; // gross corpus excl. SIP (worksheet D16)
  sipMonthly: number;
  blendedReturnPct: number; // amount-weighted across lumpsum sleeves
  investedA: number; // corpus + SIP contributions over horizon A
  investedB: number;
  valueA: number; // total value at horizon A (incl SIP FV)
  valueB: number;
  gainA: number;
  gainB: number;
  buckets: BucketShare[]; // mix by risk bucket (lumpsum + SIP corpus-equivalent excluded → lumpsum only)
  growth: { year: number; value: number }[]; // total value 0..maxHorizon
};

export type AllocResult = {
  existing: PortfolioResult;
  suggested: PortfolioResult;
  upliftA: number; // suggested.valueA - existing.valueA
  upliftB: number;
  blendedDeltaPct: number;
};

const lumpFv = (amount: number, ratePct: number, years: number) =>
  amount * Math.pow(1 + ratePct / 100, years);

/** Monthly SIP future value, annuity-due (contribution at start of month). */
export function sipFvAnnuityDue(monthly: number, annualRatePct: number, years: number): number {
  const i = annualRatePct / 100 / 12;
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  if (i === 0) return monthly * n;
  return monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
}

function valueAtYear(rows: AllocRow[], year: number): number {
  return ALLOC_CLASSES.reduce((sum, c, idx) => {
    const r = rows[idx] ?? { amount: 0, returnPct: c.defaultReturnPct };
    if (c.kind === "monthly") return sum + sipFvAnnuityDue(r.amount, r.returnPct, year);
    return sum + lumpFv(r.amount, r.returnPct, year);
  }, 0);
}

function computePortfolio(rows: AllocRow[], horizonA: number, horizonB: number, maxYear: number): PortfolioResult {
  const lumpsumCorpus = ALLOC_CLASSES.reduce(
    (s, c, i) => (c.kind === "lumpsum" ? s + (rows[i]?.amount ?? 0) : s),
    0
  );
  const sipIdx = ALLOC_CLASSES.findIndex((c) => c.kind === "monthly");
  const sipMonthly = rows[sipIdx]?.amount ?? 0;

  const sleeves: SleeveResult[] = ALLOC_CLASSES.map((c, i) => {
    const r = rows[i] ?? { amount: 0, returnPct: c.defaultReturnPct };
    const isMonthly = c.kind === "monthly";
    return {
      key: c.key,
      label: c.label,
      kind: c.kind,
      bucket: c.bucket,
      amount: r.amount,
      returnPct: r.returnPct,
      allocationPct: isMonthly || lumpsumCorpus <= 0 ? 0 : (r.amount / lumpsumCorpus) * 100,
      fvA: isMonthly ? sipFvAnnuityDue(r.amount, r.returnPct, horizonA) : lumpFv(r.amount, r.returnPct, horizonA),
      fvB: isMonthly ? sipFvAnnuityDue(r.amount, r.returnPct, horizonB) : lumpFv(r.amount, r.returnPct, horizonB),
    };
  });

  // amount-weighted blended return across lumpsum sleeves
  const weighted = ALLOC_CLASSES.reduce(
    (s, c, i) => (c.kind === "lumpsum" ? s + (rows[i]?.amount ?? 0) * (rows[i]?.returnPct ?? 0) : s),
    0
  );
  const blendedReturnPct = lumpsumCorpus > 0 ? weighted / lumpsumCorpus : 0;

  // risk-bucket mix (lumpsum corpus only — SIP is a flow, shown separately)
  const buckets: BucketShare[] = ASSET_BUCKETS.map((b) => {
    const amount = ALLOC_CLASSES.reduce(
      (s, c, i) => (c.kind === "lumpsum" && c.bucket === b ? s + (rows[i]?.amount ?? 0) : s),
      0
    );
    return { bucket: b, amount, pct: lumpsumCorpus > 0 ? (amount / lumpsumCorpus) * 100 : 0 };
  }).filter((x) => x.amount > 0);

  const valueA = sleeves.reduce((s, x) => s + x.fvA, 0);
  const valueB = sleeves.reduce((s, x) => s + x.fvB, 0);
  const investedA = lumpsumCorpus + sipMonthly * 12 * horizonA;
  const investedB = lumpsumCorpus + sipMonthly * 12 * horizonB;

  const growth = Array.from({ length: maxYear + 1 }, (_, y) => ({ year: y, value: valueAtYear(rows, y) }));

  return {
    sleeves,
    lumpsumCorpus,
    sipMonthly,
    blendedReturnPct,
    investedA,
    investedB,
    valueA,
    valueB,
    gainA: valueA - investedA,
    gainB: valueB - investedB,
    buckets,
    growth,
  };
}

export function computeAssetAllocationReview(existingRows: AllocRow[], suggestedRows: AllocRow[], input: { horizonA: number; horizonB: number }): AllocResult {
  const horizonA = Math.max(0, Math.round(input.horizonA));
  const horizonB = Math.max(0, Math.round(input.horizonB));
  const maxYear = Math.max(horizonA, horizonB, 1);
  const existing = computePortfolio(existingRows, horizonA, horizonB, maxYear);
  const suggested = computePortfolio(suggestedRows, horizonA, horizonB, maxYear);
  return {
    existing,
    suggested,
    upliftA: suggested.valueA - existing.valueA,
    upliftB: suggested.valueB - existing.valueB,
    blendedDeltaPct: suggested.blendedReturnPct - existing.blendedReturnPct,
  };
}

/** Worksheet sample (Existing) + a diversified Suggested rebalance of the same corpus. */
export const EXISTING_DEFAULTS: AllocRow[] = ALLOC_CLASSES.map((c) => {
  const amount =
    c.key === "gold" ? 7500000 :
    c.key === "debt" ? 400000 :
    c.key === "mf" ? 2500000 :
    c.key === "sip" ? 100000 :
    c.key === "pe" ? 200000 :
    c.key === "eqlt" ? 600000 : 0;
  return { amount, returnPct: c.defaultReturnPct };
});

export const SUGGESTED_DEFAULTS: AllocRow[] = ALLOC_CLASSES.map((c) => {
  const amount =
    c.key === "ppf" ? 300000 :
    c.key === "gold" ? 2000000 :
    c.key === "debt" ? 700000 :
    c.key === "mf" ? 4000000 :
    c.key === "sip" ? 100000 :
    c.key === "pms" ? 500000 :
    c.key === "intl" ? 1500000 :
    c.key === "pe" ? 200000 :
    c.key === "eqlt" ? 2000000 : 0;
  return { amount, returnPct: c.defaultReturnPct };
});
