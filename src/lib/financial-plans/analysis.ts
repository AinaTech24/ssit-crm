/**
 * CFP-grade analysis helpers for the Financial Plan module — shared by the
 * builder (client), the detail view (server) and the printed plan so every
 * surface shows the SAME methodology.
 *
 * Upgrades over the old rules-of-thumb:
 *  - Life cover via a need-analysis (liabilities + goals + PV of family expenses
 *    − financial assets), not a flat 10× income.
 *  - Emergency fund credits liquid assets already on the balance sheet.
 *  - A funding-feasibility check (required SIP vs investable surplus) so a plan
 *    can't quietly ask for more than the client can save.
 *  - Standard planning ratios (net worth, liquidity months, savings, DTI, solvency).
 */

import { computeNeedAnalysis } from "@/lib/calculators/hlv";

export type AssetLite = { category?: string; value?: number | string };
export type LiabilityLite = { value?: number | string; monthlyEmi?: number | string };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const FINANCIAL_CATS = ["equity", "debt", "gold", "cash"];

/** Investable / financial assets (excludes real estate + "other") that can offset an insurance need. */
export function financialAssetsTotal(assets: AssetLite[]): number {
  return (assets ?? []).filter((a) => FINANCIAL_CATS.includes(String(a.category))).reduce((s, a) => s + n(a.value), 0);
}

/** Liquid assets available for an emergency (cash / savings / liquid funds). */
export function liquidAssetsTotal(assets: AssetLite[]): number {
  return (assets ?? []).filter((a) => String(a.category) === "cash").reduce((s, a) => s + n(a.value), 0);
}

export function totalMonthlyEmi(liabilities: LiabilityLite[]): number {
  return (liabilities ?? []).reduce((s, l) => s + n(l.monthlyEmi), 0);
}

/* ── Life cover: need-analysis, not 10× ── */
export type LifeCoverInput = {
  monthlyExpenses: number;
  totalLiabilities: number;
  goalsPresentCostTotal: number;
  financialAssets: number;
  existingCover: number;
  yearsOfSupport?: number;
  inflationPct?: number;
  discountPct?: number;
};
export type LifeCoverResult = {
  recommended: number; // gross cover the family needs (net of financial assets)
  additional: number; // additional cover to buy (net of existing policies)
  pvFamilyNeed: number;
  yearsOfSupport: number;
  inflationPct: number;
  discountPct: number;
};

export function recommendedLifeCover(input: LifeCoverInput): LifeCoverResult {
  const yearsOfSupport = input.yearsOfSupport ?? 25;
  const inflationPct = input.inflationPct ?? 6;
  const discountPct = input.discountPct ?? 8;
  // existingCover=0 here so coverRequired is the GROSS recommended figure
  // (liabilities + goals + PV of family expenses − financial assets).
  const na = computeNeedAnalysis({
    outstandingLiabilities: Math.max(0, input.totalLiabilities),
    futureGoals: Math.max(0, input.goalsPresentCostTotal),
    familyAnnualNeed: Math.max(0, input.monthlyExpenses) * 12,
    yearsOfSupport,
    incrementPct: inflationPct,
    discountPct,
    existingAssets: Math.max(0, input.financialAssets),
    existingCover: 0,
  });
  const recommended = na.coverRequired;
  return {
    recommended,
    additional: Math.max(0, recommended - Math.max(0, input.existingCover)),
    pvFamilyNeed: na.pvFamilyNeed,
    yearsOfSupport,
    inflationPct,
    discountPct,
  };
}

/* ── Emergency fund: credit liquid assets ── */
export type EmergencyInput = { monthlyExpenses: number; targetMonths: number; earmarkedFund: number; liquidAssets: number };
export type EmergencyResult = { target: number; available: number; gap: number; monthsCovered: number };

export function emergencyStatus(input: EmergencyInput): EmergencyResult {
  const target = Math.max(0, input.monthlyExpenses) * Math.max(0, input.targetMonths);
  const available = Math.max(0, input.earmarkedFund) + Math.max(0, input.liquidAssets);
  return {
    target,
    available,
    gap: Math.max(0, target - available),
    monthsCovered: input.monthlyExpenses > 0 ? available / input.monthlyExpenses : 0,
  };
}

/* ── Funding feasibility: required SIP vs investable surplus ── */
export type FeasibilityInput = {
  monthlyIncome: number;
  monthlyExpenses: number;
  totalMonthlyEmi: number;
  requiredAdditionalSip: number;
};
export type FeasibilityResult = {
  investableSurplus: number;
  requiredAdditionalSip: number;
  feasible: boolean;
  shortfall: number;
  utilizationPct: number; // share of surplus the SIPs consume (100 = exactly maxed)
};

export function planFeasibility(input: FeasibilityInput): FeasibilityResult {
  const investableSurplus = Math.max(0, input.monthlyIncome - input.monthlyExpenses - input.totalMonthlyEmi);
  const required = Math.max(0, input.requiredAdditionalSip);
  const shortfall = Math.max(0, required - investableSurplus);
  return {
    investableSurplus,
    requiredAdditionalSip: required,
    feasible: shortfall <= 0,
    shortfall,
    utilizationPct: investableSurplus > 0 ? Math.round((required / investableSurplus) * 100) : required > 0 ? 999 : 0,
  };
}

/* ── Standard planning ratios ── */
export type RatiosInput = {
  monthlyIncome: number;
  monthlyExpenses: number;
  totalMonthlyEmi: number;
  totalAssets: number;
  totalLiabilities: number;
  liquidAssets: number;
};
export type RatiosResult = {
  netWorth: number;
  liquidityMonths: number;
  savingsRatePct: number;
  debtToIncomePct: number;
  solvencyPct: number;
};

export function cfpRatios(input: RatiosInput): RatiosResult {
  const netWorth = input.totalAssets - input.totalLiabilities;
  const surplus = Math.max(0, input.monthlyIncome - input.monthlyExpenses - input.totalMonthlyEmi);
  return {
    netWorth,
    liquidityMonths: input.monthlyExpenses > 0 ? input.liquidAssets / input.monthlyExpenses : 0,
    savingsRatePct: input.monthlyIncome > 0 ? Math.round((surplus / input.monthlyIncome) * 100) : 0,
    debtToIncomePct: input.monthlyIncome > 0 ? Math.round((input.totalMonthlyEmi / input.monthlyIncome) * 100) : 0,
    solvencyPct: input.totalAssets > 0 ? Math.round((netWorth / input.totalAssets) * 100) : 0,
  };
}
