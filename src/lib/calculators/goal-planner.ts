/**
 * Goal Planner — math engine.
 *
 * For a future financial goal, computes the investment needed via four modes:
 *   • Lumpsum                — one-shot today
 *   • Monthly SIP            — for the full goal period
 *   • Limited-period SIP     — SIP for fewer years, corpus then grows to the goal
 *   • Lumpsum + Monthly SIP  — a given lumpsum, SIP fills the remaining gap
 *
 * Return is the allocation-weighted average of Debt/Hybrid/Equity rates.
 * Convention: lumpsum/limited-growth use annual compounding; SIP uses an
 * effective-monthly ORDINARY annuity (end-of-month). Verified to the rupee
 * against the reference case study (e.g. ₹50L / 15y / 12%: lumpsum ₹9,13,481,
 * SIP ₹10,605, limited-10y SIP ₹12,784, ₹5L lumpsum + SIP ₹4,800).
 */

export type CostBasis = "future" | "current";
export type Allocation = { debt: number; hybrid: number; equity: number };
export type Rates = { debt: number; hybrid: number; equity: number };

export function portfolioReturn(alloc: Allocation, rates: Rates): number {
  const total = alloc.debt + alloc.hybrid + alloc.equity;
  if (total <= 0) return 0;
  return (alloc.debt * rates.debt + alloc.hybrid * rates.hybrid + alloc.equity * rates.equity) / total;
}

/** Effective-monthly ORDINARY annuity factor (FV of ₹1/month for `months`). */
export function sipFactor(annualPct: number, months: number): number {
  if (months <= 0) return 0;
  const m = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  return m === 0 ? months : (Math.pow(1 + m, months) - 1) / m;
}

export type GoalInput = {
  costBasis: CostBasis;
  cost: number; // future cost, or current cost (then inflated)
  inflationPct: number; // used when costBasis = "current"
  periodYears: number;
  alloc: Allocation;
  rates: Rates;
  limitedYears: number; // for the limited-period SIP mode
  comboLumpsum: number; // for the lumpsum + SIP mode
};

export type GoalResult = {
  futureCost: number;
  returnPct: number;
  lumpsum: number;
  monthlySip: number;
  limitedSip: number;
  limitedYears: number;
  comboLumpsum: number;
  comboSip: number;
};

export function computeGoal(input: GoalInput): GoalResult {
  const n = Math.max(0, Math.round(input.periodYears));
  const returnPct = portfolioReturn(input.alloc, input.rates);
  const r = returnPct / 100;

  const futureCost =
    input.costBasis === "current"
      ? input.cost * Math.pow(1 + input.inflationPct / 100, n)
      : input.cost;

  const lumpsum = n <= 0 ? futureCost : futureCost / Math.pow(1 + r, n);
  const monthlySip = futureCost / (sipFactor(returnPct, n * 12) || 1);

  // Limited-period SIP: invest for L years, the corpus then grows untouched to
  // the goal year.
  const L = Math.min(Math.max(0, Math.round(input.limitedYears)), n);
  const targetAtLimited = futureCost / Math.pow(1 + r, Math.max(0, n - L));
  const limitedSip = L > 0 ? targetAtLimited / (sipFactor(returnPct, L * 12) || 1) : 0;

  // Lumpsum + SIP: given lumpsum grows to its FV; SIP fills the remaining gap.
  const comboFV = input.comboLumpsum * Math.pow(1 + r, n);
  const comboSip = Math.max(0, futureCost - comboFV) / (sipFactor(returnPct, n * 12) || 1);

  return {
    futureCost,
    returnPct,
    lumpsum,
    monthlySip,
    limitedSip,
    limitedYears: L,
    comboLumpsum: input.comboLumpsum,
    comboSip,
  };
}
