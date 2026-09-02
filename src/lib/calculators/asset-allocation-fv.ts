/**
 * Asset Allocation Future Value — math engine.
 *
 * Splits a lumpsum across asset classes (each with its own assumed return and
 * allocation %) and grows each sleeve over the investment period. Reports the
 * portfolio future value and the blended (effective) annualised return, and can
 * compare two allocation strategies side by side.
 *
 * CONVENTION — annual compounding per asset; each sleeve grows independently:
 *   sleeveFV = initial × allocation% × (1 + rate)^years
 *   portfolioFV = Σ sleeveFV ;  blended return = (portfolioFV / invested)^(1/years) − 1.
 * Calibrated to the reference case study to the rupee:
 *   ₹10,00,000 · 15 yrs · {Bonds 6%/20, Debt 7%/30, Equity 12%/40, Gold 8%/10}
 *     → ₹38,13,664 · 9.33%
 *   {Equity 12%/60, Hybrid 9%/25, Gold 8%/10, Debt 7%/5} → ₹46,49,929 · 10.79%.
 */

export const ASSET_CLASSES: { value: string; label: string; defaultReturn: number }[] = [
  { value: "equity", label: "Equity", defaultReturn: 12 },
  { value: "hybrid", label: "Hybrid Funds", defaultReturn: 9 },
  { value: "debt", label: "Debt Funds", defaultReturn: 7 },
  { value: "bonds", label: "Bonds", defaultReturn: 6 },
  { value: "gold", label: "Gold", defaultReturn: 8 },
  { value: "international", label: "International Equity", defaultReturn: 11 },
  { value: "reits", label: "REITs / InvITs", defaultReturn: 9 },
  { value: "liquid", label: "Liquid / Cash", defaultReturn: 5.5 },
  { value: "other", label: "Other", defaultReturn: 8 },
];

export type AssetRow = { assetClass: string; ratePct: number; allocationPct: number };

export type AssetSleeveResult = {
  assetClass: string;
  allocationPct: number;
  ratePct: number;
  invested: number;
  futureValue: number;
};

export type AssetScenarioResult = {
  assets: AssetSleeveResult[];
  totalAllocationPct: number;
  totalInvested: number;
  futureValue: number;
  gain: number;
  blendedReturnPct: number;
  schedule: { year: number; value: number }[];
};

export type AssetAllocationInput = {
  initialInvestment: number;
  years: number;
  scenario1: AssetRow[];
  scenario2: AssetRow[] | null;
};

export type AssetAllocationResult = {
  scenario1: AssetScenarioResult;
  scenario2: AssetScenarioResult | null;
};

function runScenario(initial: number, years: number, rows: AssetRow[]): AssetScenarioResult {
  const n = Math.max(0, years);
  const assets: AssetSleeveResult[] = rows.map((r) => {
    const invested = (initial * r.allocationPct) / 100;
    const futureValue = invested * Math.pow(1 + r.ratePct / 100, n);
    return { assetClass: r.assetClass, allocationPct: r.allocationPct, ratePct: r.ratePct, invested, futureValue };
  });
  const totalAllocationPct = rows.reduce((s, r) => s + r.allocationPct, 0);
  const totalInvested = assets.reduce((s, a) => s + a.invested, 0);
  const futureValue = assets.reduce((s, a) => s + a.futureValue, 0);
  const blendedReturnPct =
    totalInvested > 0 && n > 0 ? (Math.pow(futureValue / totalInvested, 1 / n) - 1) * 100 : 0;

  // Year-by-year portfolio value.
  const schedule: { year: number; value: number }[] = [];
  for (let y = 1; y <= Math.round(n); y++) {
    const value = assets.reduce((s, a) => s + a.invested * Math.pow(1 + a.ratePct / 100, y), 0);
    schedule.push({ year: y, value });
  }

  return { assets, totalAllocationPct, totalInvested, futureValue, gain: futureValue - totalInvested, blendedReturnPct, schedule };
}

export function computeAssetAllocationFv(input: AssetAllocationInput): AssetAllocationResult {
  return {
    scenario1: runScenario(input.initialInvestment, input.years, input.scenario1),
    scenario2:
      input.scenario2 && input.scenario2.length > 0
        ? runScenario(input.initialInvestment, input.years, input.scenario2)
        : null,
  };
}
