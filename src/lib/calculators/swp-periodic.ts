/**
 * SWP Periodic Withdrawal Planner — math engine.
 *
 * A flexible plan that lets a distributor invest a client's money (lumpsum,
 * annual lumpsum, SIP, or lumpsum + SIP), optionally let it grow for a deferment
 * period, then draw a FIXED amount at PERIODIC intervals (e.g. ₹1,00,000 every
 * 2 years, 10 times) while the rest keeps compounding — and see the year-by-year
 * fund value plus the end value.
 *
 * The accumulation return is the asset-allocation-weighted average of the debt /
 * hybrid / equity assumptions; if a deferment is set, the distribution phase can
 * use a separate (typically lower) return.
 *
 * CONVENTIONS — annual corpus growth; a year's SIP earns its year-end value at
 * the EFFECTIVE monthly rate, BEGIN-mode; withdrawals taken at year end.
 * Calibrated to the reference case study to the rupee:
 *   monthly SIP ₹10,000 · 20 yrs · 12% · ₹1,00,000 every 2 yrs × 10 →
 *   year-1 fund ₹1,27,665 · end value ₹57,99,873.
 */

export type SwpInvestMode = "lumpsum" | "annual_lumpsum" | "sip" | "lumpsum_sip";

export type SwpAllocation = { debt: number; hybrid: number; equity: number };

export type SwpPeriodicInput = {
  customHeader?: string;
  currentAge?: number;

  investMode: SwpInvestMode;
  initialInvestment: number; // lumpsum / lumpsum_sip
  monthlySip: number; // sip / lumpsum_sip
  sipYears: number; // years of SIP contribution
  annualAmount: number; // annual_lumpsum
  annualYears: number; // years of annual-lumpsum contribution

  allocation: SwpAllocation; // % weights (should total 100)
  returns: SwpAllocation; // assumed return per asset class (%)

  defermentRequired: boolean;
  distributionReturnPct: number; // return during withdrawal phase (if deferment)
  defermentPeriodYears: number;

  withdrawalIntervalYears: number;
  numInstallments: number;
  eachWithdrawalAmount: number;
};

export type SwpYearRow = {
  age: number | null;
  year: number;
  phase: "accumulation" | "distribution";
  annualInvestment: number;
  withdrawalAmount: number;
  fundValueEndOfYear: number;
};

export type SwpPeriodicResult = {
  averageReturnPct: number;
  allocationTotalPct: number;
  totalInvested: number;
  totalPeriodicWithdrawal: number;
  endValue: number;
  corpusDepleted: boolean;
  firstWithdrawalYear: number;
  lastWithdrawalYear: number;
  horizonYears: number;
  schedule: SwpYearRow[];
};

/** FV at year end of 12 monthly ₹1 contributions, effective monthly, begin-mode. */
function yearSipFactor(annualReturnPct: number): number {
  const m = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  let f = 0;
  for (let k = 0; k < 12; k++) f += Math.pow(1 + m, 12 - k); // begin-of-month k → grows (12−k) months
  return f;
}

export function computeSwpPeriodic(input: SwpPeriodicInput): SwpPeriodicResult {
  const alloc = input.allocation;
  const ret = input.returns;
  const allocationTotalPct = alloc.debt + alloc.hybrid + alloc.equity;
  // Weighted average accumulation return. If weights don't total 100, normalise
  // by the actual total so the average stays sensible.
  const wTotal = allocationTotalPct > 0 ? allocationTotalPct : 100;
  const averageReturnPct =
    (alloc.debt * ret.debt + alloc.hybrid * ret.hybrid + alloc.equity * ret.equity) / wTotal;

  const usesLump = input.investMode === "lumpsum" || input.investMode === "lumpsum_sip";
  const usesSip = input.investMode === "sip" || input.investMode === "lumpsum_sip";
  const usesAnnual = input.investMode === "annual_lumpsum";

  const sipYears = usesSip ? Math.max(0, Math.round(input.sipYears)) : 0;
  const annualYears = usesAnnual ? Math.max(0, Math.round(input.annualYears)) : 0;
  const deferment = input.defermentRequired ? Math.max(0, Math.round(input.defermentPeriodYears)) : 0;
  const interval = Math.max(1, Math.round(input.withdrawalIntervalYears));
  const installments = Math.max(0, Math.round(input.numInstallments));

  const lastWithdrawalYear = deferment + installments * interval;
  const firstWithdrawalYear = installments > 0 ? deferment + interval : 0;
  const investEnd = Math.max(sipYears, annualYears);
  const horizon = Math.max(investEnd, lastWithdrawalYear, 1);

  let corpus = usesLump ? input.initialInvestment : 0;
  let totalInvested = usesLump ? input.initialInvestment : 0;
  let withdrawalsTaken = 0;
  let corpusDepleted = false;
  const schedule: SwpYearRow[] = [];

  for (let y = 1; y <= horizon; y++) {
    const inDistribution = input.defermentRequired && y > deferment;
    const R = inDistribution ? input.distributionReturnPct : averageReturnPct;

    // Year's fresh investment (begin-mode within the year).
    let annualInvestment = 0;
    if (usesSip && y <= sipYears) annualInvestment = input.monthlySip * 12;
    if (usesAnnual && y <= annualYears) annualInvestment = input.annualAmount;

    // Grow existing corpus for the year, then add the year's investment FV.
    corpus = corpus * (1 + R / 100);
    if (usesSip && y <= sipYears) corpus += input.monthlySip * yearSipFactor(R);
    if (usesAnnual && y <= annualYears) corpus += input.annualAmount * (1 + R / 100); // begin-of-year
    totalInvested += annualInvestment;

    // Periodic withdrawal at year end.
    let withdrawalAmount = 0;
    if (
      installments > 0 &&
      y > deferment &&
      (y - deferment) % interval === 0 &&
      withdrawalsTaken < installments
    ) {
      withdrawalAmount = input.eachWithdrawalAmount;
      corpus -= withdrawalAmount;
      withdrawalsTaken++;
      if (corpus < 0) {
        corpusDepleted = true;
        corpus = 0;
      }
    }

    schedule.push({
      age: input.currentAge && input.currentAge > 0 ? input.currentAge + y : null,
      year: y,
      phase: inDistribution || (installments > 0 && y >= firstWithdrawalYear) ? "distribution" : "accumulation",
      annualInvestment,
      withdrawalAmount,
      fundValueEndOfYear: corpus,
    });
  }

  return {
    averageReturnPct,
    allocationTotalPct,
    totalInvested,
    totalPeriodicWithdrawal: installments * input.eachWithdrawalAmount,
    endValue: corpus,
    corpusDepleted,
    firstWithdrawalYear,
    lastWithdrawalYear,
    horizonYears: horizon,
    schedule,
  };
}
