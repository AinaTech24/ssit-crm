/**
 * STP Comprehensive Planner — math engine.
 *
 * Future value of a lumpsum routed Debt → Equity via a Systematic Transfer Plan.
 * The lumpsum sits in a debt fund (lower return); at the chosen frequency a slice
 * is transferred into an equity fund (higher return). Two transfer modes:
 *   • "fixed"        — a fixed ₹ amount each period, for a set number of installments.
 *   • "appreciation" — only the debt fund's GAIN each period moves to equity, so
 *                      the debt principal stays put and its returns ride the market.
 *
 * Frequencies: daily / weekly / fortnightly / monthly / quarterly / half-yearly /
 * annually. The whole timeline is simulated at the transfer frequency, then
 * snapshotted into a year-by-year report.
 *
 * CONVENTIONS — calibrated to the reference case study to the rupee:
 *   per-period rate = (1 + annual)^(1/periodsPerYear) − 1 (effective); each period
 *   the funds GROW, then the transfer is taken at period end.
 *   Worked example (₹25,00,000 · debt 5% · equity 12% · fixed ₹50,000 weekly ×
 *   50 · 10 yrs): equity end-yr-1 ₹26,49,946 · debt end-yr-1 ₹61,825 · total
 *   ₹74,44,420 · annualised 11.53%.
 */

export type StpTransferMode = "appreciation" | "fixed";
export type StpFrequency = "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "halfyearly" | "annually";

export const STP_FREQUENCIES: { value: StpFrequency; label: string; perYear: number }[] = [
  { value: "daily", label: "Daily", perYear: 365 },
  { value: "weekly", label: "Weekly", perYear: 52 },
  { value: "fortnightly", label: "Fortnightly", perYear: 26 },
  { value: "monthly", label: "Monthly", perYear: 12 },
  { value: "quarterly", label: "Quarterly", perYear: 4 },
  { value: "halfyearly", label: "Half-yearly", perYear: 2 },
  { value: "annually", label: "Annually", perYear: 1 },
];

export type StpComprehensiveInput = {
  initialInvestment: number;
  debtReturnPct: number;
  equityReturnPct: number;
  transferMode: StpTransferMode;
  frequency: StpFrequency;
  numInstallments: number;
  fixedTransferAmount: number; // used in "fixed" mode
  totalMonths: number; // total investment period in months
};

export type StpYearRow = {
  year: number;
  debtBeginning: number;
  transferredToEquity: number;
  equityBeginning: number;
  equityEnd: number;
  totalEnd: number;
  annualisedReturnPct: number;
};

export type StpComprehensiveResult = {
  periodsPerYear: number;
  totalPeriods: number;
  totalTransferred: number;
  debtFinalValue: number;
  equityFinalValue: number;
  totalFinalValue: number;
  annualisedReturnPct: number;
  schedule: StpYearRow[];
};

const perYearOf = (f: StpFrequency) => STP_FREQUENCIES.find((x) => x.value === f)?.perYear ?? 12;

export function computeStpComprehensive(input: StpComprehensiveInput): StpComprehensiveResult {
  const ppy = perYearOf(input.frequency);
  const totalYears = Math.max(0, input.totalMonths) / 12;
  const totalPeriods = Math.max(1, Math.round(totalYears * ppy));
  const rd = Math.pow(1 + input.debtReturnPct / 100, 1 / ppy) - 1;
  const re = Math.pow(1 + input.equityReturnPct / 100, 1 / ppy) - 1;
  const installments = Math.max(0, Math.round(input.numInstallments));

  let debt = input.initialInvestment;
  let equity = 0;
  let totalTransferred = 0;

  // Year-boundary snapshots.
  const schedule: StpYearRow[] = [];
  let yearDebtBegin = debt;
  let yearEquityBegin = equity;
  let yearTransferred = 0;
  let transfersDone = 0;

  for (let p = 1; p <= totalPeriods; p++) {
    const debtBefore = debt;
    debt = debt * (1 + rd);
    equity = equity * (1 + re);

    // Transfer at period end, only while installments remain.
    if (transfersDone < installments && debt > 0) {
      let t: number;
      if (input.transferMode === "appreciation") {
        t = Math.max(0, debt - debtBefore); // the period's debt gain
      } else {
        t = Math.min(input.fixedTransferAmount, debt);
      }
      t = Math.min(t, debt);
      debt -= t;
      equity += t;
      totalTransferred += t;
      yearTransferred += t;
      transfersDone++;
    }

    // Year boundary → snapshot.
    if (p % ppy === 0 || p === totalPeriods) {
      const yr = Math.ceil(p / ppy);
      const totalEnd = debt + equity;
      const elapsedYears = p / ppy;
      const annualised =
        input.initialInvestment > 0 && elapsedYears > 0
          ? (Math.pow(totalEnd / input.initialInvestment, 1 / elapsedYears) - 1) * 100
          : 0;
      schedule.push({
        year: yr,
        debtBeginning: yearDebtBegin,
        transferredToEquity: yearTransferred,
        equityBeginning: yearEquityBegin,
        equityEnd: equity,
        totalEnd,
        annualisedReturnPct: annualised,
      });
      yearDebtBegin = debt;
      yearEquityBegin = equity;
      yearTransferred = 0;
    }
  }

  const totalFinalValue = debt + equity;
  const annualisedReturnPct =
    input.initialInvestment > 0 && totalYears > 0
      ? (Math.pow(totalFinalValue / input.initialInvestment, 1 / totalYears) - 1) * 100
      : 0;

  return {
    periodsPerYear: ppy,
    totalPeriods,
    totalTransferred,
    debtFinalValue: debt,
    equityFinalValue: equity,
    totalFinalValue,
    annualisedReturnPct,
    schedule,
  };
}
