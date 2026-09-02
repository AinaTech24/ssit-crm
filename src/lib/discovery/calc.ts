/**
 * Financial Discovery — the calculation engine. Pure functions over the
 * fact-find data, shared by the in-meeting RM form (live recalc), the public
 * client wizard, and the server (cached snapshot). Adapted from the
 * "Financial Discovery Form" workbook, with a Financial Health Score and an
 * affordability gap added on top.
 *
 * Money is in ₹. All inputs are tolerant of undefined / strings ("" → 0).
 */

export type IncomeRow = { source?: string; annualAmount?: number | string; frequency?: string; taxable?: string; notes?: string };
export type ExpenseMap = {
  rent?: number | string;
  groceries?: number | string;
  education?: number | string;
  insurance?: number | string;
  vehicle?: number | string;
  utilities?: number | string;
  medical?: number | string;
  entertainment?: number | string;
  clothing?: number | string;
  other?: number | string;
};
export type AssetRow = { description?: string; category?: string; currentValue?: number | string; invested?: number | string; liquid?: string; notes?: string };
export type LiabilityRow = { description?: string; type?: string; outstanding?: number | string; emi?: number | string; ratePct?: number | string; tenureMonths?: number | string; notes?: string };
export type LifePolicyRow = { policy?: string; type?: string; sumAssured?: number | string; premium?: number | string; term?: number | string; maturityYear?: number | string; nominee?: string; status?: string };
export type HealthPolicyRow = { insurer?: string; type?: string; sumInsured?: number | string; premium?: number | string; members?: string; floater?: string; expiry?: string; remarks?: string };
export type GoalRow = { description?: string; type?: string; targetYear?: number | string; targetCorpus?: number | string; alreadySaved?: number | string; sipEst?: number | string; priority?: string };

export type DiscoveryData = {
  identification?: Record<string, any>;
  income?: IncomeRow[];
  expenses?: ExpenseMap;
  surplusInputs?: { annualLoanEmis?: number | string; annualInsurancePremiums?: number | string; estimatedTax?: number | string };
  assets?: AssetRow[];
  liabilities?: LiabilityRow[];
  lifeInsurance?: LifePolicyRow[];
  healthInsurance?: HealthPolicyRow[];
  goals?: GoalRow[];
  /** Risk-profiling answers (the behavioural questions from RISK_QUESTIONS). */
  riskProfile?: Record<string, string>;
  recommendations?: any[];
  assessment?: Record<string, any>;
};

import { computeRisk, type RiskResult } from "./risk";

const n = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Age in whole years from a 'YYYY-MM-DD' DOB, relative to `year` (deterministic). */
function ageFromDob(dob: unknown, year: number): number | null {
  const m = String(dob ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const age = year - Number(m[1]);
  return age > 0 && age < 120 ? age : null;
}

export type DiscoveryComputed = {
  grossAnnualIncome: number;
  monthlyExpenses: number;
  annualExpenses: number;
  annualLoanEmis: number;
  annualInsurancePremiums: number;
  estimatedTax: number;
  netInvestableSurplus: number;
  monthlySipCapacity: number;
  surplusRatio: number; // surplus / income
  totalAssets: number;
  totalInvested: number;
  liquidAssets: number;
  totalLiabilities: number;
  totalEmi: number;
  netWorth: number;
  debtToAssetRatio: number; // %
  totalLifeCover: number;
  totalLifePremium: number;
  recommendedLifeCover: number; // 10× income
  lifeCoverGap: number;
  totalHealthCover: number;
  totalCorpusTarget: number;
  totalAlreadySaved: number;
  totalSipNeeded: number;
  emergencyFundTarget: number; // 6× monthly expenses
  emergencyFundCovered: number; // liquidAssets / target, capped 1
  affordabilityGap: number; // capacity − needed (negative = shortfall)
  healthScore: number; // 0-100
  healthBand: "Excellent" | "Good" | "Fair" | "Needs work";
  scoreParts: { label: string; score: number; max: number; hint: string }[];
  /** Risk profile (0–50 score, 6-band) + product suitability matrix. */
  risk: RiskResult;
};

/** Monthly SIP needed to reach a future corpus, given years and an assumed
 *  annual return. Standard FV-of-annuity solved for the payment. */
export function sipForGoal(targetCorpus: number, alreadySaved: number, years: number, annualReturnPct = 11): number {
  const gap = Math.max(0, targetCorpus - alreadySaved * Math.pow(1 + annualReturnPct / 100, Math.max(0, years)));
  if (gap <= 0 || years <= 0) return 0;
  const r = annualReturnPct / 100 / 12;
  const months = years * 12;
  if (r === 0) return gap / months;
  return (gap * r) / (Math.pow(1 + r, months) - 1);
}

export function computeDiscovery(d: DiscoveryData, opts?: { currentYear?: number }): DiscoveryComputed {
  const year = opts?.currentYear ?? 2026;
  const grossAnnualIncome = (d.income ?? []).reduce((s, r) => s + n(r.annualAmount), 0);

  const e = d.expenses ?? {};
  const monthlyExpenses = n(e.rent) + n(e.groceries) + n(e.education) + n(e.insurance) + n(e.vehicle) + n(e.utilities) + n(e.medical) + n(e.entertainment) + n(e.clothing) + n(e.other);
  const annualExpenses = monthlyExpenses * 12;

  const annualLoanEmis = n(d.surplusInputs?.annualLoanEmis);
  const annualInsurancePremiums = n(d.surplusInputs?.annualInsurancePremiums);
  const estimatedTax = n(d.surplusInputs?.estimatedTax);

  const netInvestableSurplus = grossAnnualIncome - annualExpenses - annualLoanEmis - annualInsurancePremiums - estimatedTax;
  const monthlySipCapacity = netInvestableSurplus / 12;
  const surplusRatio = grossAnnualIncome > 0 ? netInvestableSurplus / grossAnnualIncome : 0;

  const totalAssets = (d.assets ?? []).reduce((s, r) => s + n(r.currentValue), 0);
  const totalInvested = (d.assets ?? []).reduce((s, r) => s + n(r.invested), 0);
  const liquidAssets = (d.assets ?? []).filter((r) => String(r.liquid).toLowerCase() === "yes").reduce((s, r) => s + n(r.currentValue), 0);
  const totalLiabilities = (d.liabilities ?? []).reduce((s, r) => s + n(r.outstanding), 0);
  const totalEmi = (d.liabilities ?? []).reduce((s, r) => s + n(r.emi), 0);
  const netWorth = totalAssets - totalLiabilities;
  const debtToAssetRatio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0;

  const totalLifeCover = (d.lifeInsurance ?? []).reduce((s, r) => s + n(r.sumAssured), 0);
  const totalLifePremium = (d.lifeInsurance ?? []).reduce((s, r) => s + n(r.premium), 0);
  const recommendedLifeCover = grossAnnualIncome * 10;
  const lifeCoverGap = Math.max(0, recommendedLifeCover - totalLifeCover);
  const totalHealthCover = (d.healthInsurance ?? []).reduce((s, r) => s + n(r.sumInsured), 0);

  const goals = d.goals ?? [];
  const totalCorpusTarget = goals.reduce((s, g) => s + n(g.targetCorpus), 0);
  const totalAlreadySaved = goals.reduce((s, g) => s + n(g.alreadySaved), 0);
  const totalSipNeeded = goals.reduce((s, g) => {
    const explicit = n(g.sipEst);
    if (explicit > 0) return s + explicit;
    const years = Math.max(0, n(g.targetYear) - year);
    return s + sipForGoal(n(g.targetCorpus), n(g.alreadySaved), years);
  }, 0);

  const emergencyFundTarget = monthlyExpenses * 6;
  const emergencyFundCovered = emergencyFundTarget > 0 ? Math.min(1, liquidAssets / emergencyFundTarget) : 1;
  const affordabilityGap = monthlySipCapacity - totalSipNeeded;

  // ── Financial Health Score: five 20-pt pillars ───────────────────────────
  const parts: { label: string; score: number; max: number; hint: string }[] = [];
  // 1. Savings rate
  const sr = surplusRatio;
  parts.push({ label: "Savings rate", max: 20, score: Math.max(0, Math.min(20, Math.round((sr / 0.3) * 20))), hint: `${(sr * 100).toFixed(0)}% of income is investable (target ≥30%)` });
  // 2. Debt load (lower is better; <20% ideal, >60% bad)
  const debtScore = debtToAssetRatio <= 0 ? 20 : Math.max(0, Math.min(20, Math.round(20 - ((debtToAssetRatio - 20) / 40) * 20)));
  parts.push({ label: "Debt load", max: 20, score: Math.max(0, Math.min(20, debtScore)), hint: `Debt is ${debtToAssetRatio.toFixed(0)}% of assets (target <40%)` });
  // 3. Life insurance adequacy
  const insAdq = recommendedLifeCover > 0 ? totalLifeCover / recommendedLifeCover : 1;
  parts.push({ label: "Life cover", max: 20, score: Math.max(0, Math.min(20, Math.round(insAdq * 20))), hint: `${(insAdq * 100).toFixed(0)}% of the 10× recommended cover` });
  // 4. Emergency fund
  parts.push({ label: "Emergency fund", max: 20, score: Math.round(emergencyFundCovered * 20), hint: `${(emergencyFundCovered * 100).toFixed(0)}% of a 6-month buffer` });
  // 5. Goal funding
  const goalFund = totalSipNeeded > 0 ? Math.min(1, monthlySipCapacity / totalSipNeeded) : (goals.length ? 1 : 0.5);
  parts.push({ label: "Goal funding", max: 20, score: Math.round(goalFund * 20), hint: totalSipNeeded > 0 ? `Capacity covers ${(goalFund * 100).toFixed(0)}% of goal SIPs` : "No goals set yet" });

  const healthScore = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.score, 0)));
  const healthBand = healthScore >= 80 ? "Excellent" : healthScore >= 60 ? "Good" : healthScore >= 40 ? "Fair" : "Needs work";

  // ── Risk profile + product suitability (workbook engine). Age, income and
  //    net worth are DERIVED from the fact-find above; the rest come from the
  //    risk-profiling answers. ───────────────────────────────────────────────
  const risk = computeRisk({
    answers: d.riskProfile ?? {},
    age: ageFromDob(d.identification?.dob, year),
    grossAnnualIncome,
    netWorth,
    netWorthKnown: totalAssets > 0 || totalLiabilities > 0,
  });

  return {
    grossAnnualIncome, monthlyExpenses, annualExpenses, annualLoanEmis, annualInsurancePremiums, estimatedTax,
    netInvestableSurplus, monthlySipCapacity, surplusRatio,
    totalAssets, totalInvested, liquidAssets, totalLiabilities, totalEmi, netWorth, debtToAssetRatio,
    totalLifeCover, totalLifePremium, recommendedLifeCover, lifeCoverGap, totalHealthCover,
    totalCorpusTarget, totalAlreadySaved, totalSipNeeded,
    emergencyFundTarget, emergencyFundCovered, affordabilityGap,
    healthScore, healthBand, scoreParts: parts,
    risk,
  };
}
