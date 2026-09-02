/**
 * Policy Surrender vs. Reinvest Analyzer — math engine.
 *
 * Answers: "Should I keep paying this traditional/endowment policy, or surrender
 * it now and invest the proceeds (plus the premiums I'd save) elsewhere?"
 *
 * Two scenarios, compared at the end of the remaining policy term:
 *   • CONTINUE  — keep the surrender value locked in, pay the remaining premiums,
 *                 collect any money-back / annuity payouts and the maturity
 *                 amount. We report the nominal payout + maturity, the
 *                 incremental return over what you put in, and the policy's IRR.
 *   • SURRENDER & INVEST — take the surrender value as a lumpsum and invest it,
 *                 plus invest each premium you no longer pay (annuity-due), all
 *                 compounding at the alternate return. We report the future value
 *                 at the end of the term and the total return.
 *
 * CONVENTIONS — annual compounding; premiums paid at the START of each year
 * (annuity-due). Calibrated to the reference case study to the rupee:
 *   surrender ₹4,80,000 · 15 policy years · 10 premium years · ₹50,000 premium ·
 *   maturity ₹12,50,000 · 12% alternate →
 *     continue: incremental ₹2,70,000 · IRR ≈ 1.92%
 *     surrender & invest: ₹43,59,216 · total return ₹33,79,216 (~3.4× maturity).
 */

export type AltOption = "equity_mf" | "hybrid_mf" | "debt_mf" | "index_fund" | "ppf" | "fd" | "nps" | "other";

export const ALT_OPTIONS: { value: AltOption; label: string; typicalReturn: number }[] = [
  { value: "equity_mf", label: "Equity Mutual Fund", typicalReturn: 12 },
  { value: "hybrid_mf", label: "Hybrid Mutual Fund", typicalReturn: 10 },
  { value: "index_fund", label: "Index Fund", typicalReturn: 11 },
  { value: "debt_mf", label: "Debt Mutual Fund", typicalReturn: 7 },
  { value: "nps", label: "NPS", typicalReturn: 9 },
  { value: "ppf", label: "PPF", typicalReturn: 7.1 },
  { value: "fd", label: "Fixed Deposit", typicalReturn: 6.5 },
  { value: "other", label: "Other", typicalReturn: 10 },
];

export type SurrenderInput = {
  policyName?: string;
  currentSurrenderValue: number;
  policyYearsLeft: number; // years to maturity
  premiumYearsLeft: number; // remaining premium-paying years
  annualPremium: number;
  expectedMaturityAmount: number;
  altOption: AltOption;
  altReturnPct: number;

  // Optional future payouts if you CONTINUE (money-back / annuity).
  includeAnnuity: boolean;
  annuityStartYear: number; // first payout year
  annuityAnnualAmount: number;
  annuityYears: number;

  includePeriodic: boolean;
  periodicEveryYears: number;
  periodicAmount: number;
  periodicTimes: number;
};

export type CashflowPoint = { year: number; amount: number; kind: "premium" | "annuity" | "periodic" | "maturity" };

export type SurrenderResult = {
  // continue
  futurePremiumsPaid: number;
  totalPayouts: number;
  expectedPayoutAndMaturity: number;
  incrementalReturn: number;
  policyIrrPct: number | null;

  // surrender & invest
  lumpsumFutureValue: number;
  premiumsFutureValue: number;
  expectedValueAtEnd: number;
  totalInvested: number;
  totalReturn: number;

  // comparison
  advantageOfSurrender: number; // expectedValueAtEnd − expectedPayoutAndMaturity
  multipleVsMaturity: number; // expectedValueAtEnd ÷ maturity(+payouts)
  surrenderIsBetter: boolean;

  continueCashflows: CashflowPoint[];
};

/** Continue-path payout cashflows (money-back / annuity), if enabled. */
function payoutCashflows(input: SurrenderInput): CashflowPoint[] {
  const out: CashflowPoint[] = [];
  if (input.includeAnnuity && input.annuityAnnualAmount > 0 && input.annuityYears > 0) {
    for (let i = 0; i < input.annuityYears; i++) {
      const yr = input.annuityStartYear + i;
      if (yr >= 1 && yr <= input.policyYearsLeft) out.push({ year: yr, amount: input.annuityAnnualAmount, kind: "annuity" });
    }
  }
  if (input.includePeriodic && input.periodicAmount > 0 && input.periodicTimes > 0 && input.periodicEveryYears > 0) {
    for (let k = 1; k <= input.periodicTimes; k++) {
      const yr = k * input.periodicEveryYears;
      if (yr >= 1 && yr <= input.policyYearsLeft) out.push({ year: yr, amount: input.periodicAmount, kind: "periodic" });
    }
  }
  return out;
}

/** Net present value of the CONTINUE scenario's cashflows at rate r (decimal). */
function continueNpv(input: SurrenderInput, r: number): number {
  // Opportunity cost: keeping the policy forgoes taking the surrender value now.
  let npv = -input.currentSurrenderValue;
  // Premiums paid at the start of each remaining year (t = 0 … n−1). Clamp to the
  // policy term — you never pay premiums beyond maturity, and leaving it unclamped
  // made the IRR disagree with the summary card (which uses the clamped count).
  const premYears = Math.min(input.premiumYearsLeft, input.policyYearsLeft);
  for (let t = 0; t < premYears; t++) npv -= input.annualPremium / Math.pow(1 + r, t);
  // Payouts (if any) at their years.
  for (const p of payoutCashflows(input)) npv += p.amount / Math.pow(1 + r, p.year);
  // Maturity at the end of the policy term.
  npv += input.expectedMaturityAmount / Math.pow(1 + r, input.policyYearsLeft);
  return npv;
}

/** Policy IRR — the rate that zeroes the continue-scenario NPV (bisection). */
function solvePolicyIrr(input: SurrenderInput): number | null {
  if (input.policyYearsLeft <= 0) return null;
  // Floor at -99.99% so deeply loss-making policies (the worst case this tool
  // exists to flag) still produce an IRR instead of returning "—".
  let lo = -0.9999;
  let hi = 1.0;
  const fLo = continueNpv(input, lo);
  const fHi = continueNpv(input, hi);
  if (Number.isNaN(fLo) || Number.isNaN(fHi) || fLo * fHi > 0) return null; // no sign change → no real IRR in range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const f = continueNpv(input, mid);
    if (Math.abs(f) < 1e-6) return mid;
    if (fLo * f < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function computeSurrenderAnalysis(input: SurrenderInput): SurrenderResult {
  const r = input.altReturnPct / 100;
  const T = Math.max(0, Math.round(input.policyYearsLeft));
  const n = Math.max(0, Math.min(Math.round(input.premiumYearsLeft), T));

  // ── Continue ──
  const futurePremiumsPaid = input.annualPremium * n;
  const payouts = payoutCashflows(input);
  const totalPayouts = payouts.reduce((s, p) => s + p.amount, 0);
  const expectedPayoutAndMaturity = input.expectedMaturityAmount + totalPayouts;
  const incrementalReturn = expectedPayoutAndMaturity - input.currentSurrenderValue - futurePremiumsPaid;
  const policyIrr = solvePolicyIrr(input);

  // ── Surrender & invest ──
  const lumpsumFutureValue = input.currentSurrenderValue * Math.pow(1 + r, T);
  // Each premium invested at the START of its year (t = 0 … n−1) grows to year T.
  let premiumsFutureValue = 0;
  for (let t = 0; t < n; t++) premiumsFutureValue += input.annualPremium * Math.pow(1 + r, T - t);
  const expectedValueAtEnd = lumpsumFutureValue + premiumsFutureValue;
  const totalInvested = input.currentSurrenderValue + futurePremiumsPaid;
  const totalReturn = expectedValueAtEnd - totalInvested;

  const advantageOfSurrender = expectedValueAtEnd - expectedPayoutAndMaturity;
  const multipleVsMaturity = expectedPayoutAndMaturity > 0 ? expectedValueAtEnd / expectedPayoutAndMaturity : 0;

  const continueCashflows: CashflowPoint[] = [
    ...Array.from({ length: n }, (_, t) => ({ year: t, amount: -input.annualPremium, kind: "premium" as const })),
    ...payouts,
    { year: T, amount: input.expectedMaturityAmount, kind: "maturity" as const },
  ];

  return {
    futurePremiumsPaid,
    totalPayouts,
    expectedPayoutAndMaturity,
    incrementalReturn,
    policyIrrPct: policyIrr == null ? null : policyIrr * 100,
    lumpsumFutureValue,
    premiumsFutureValue,
    expectedValueAtEnd,
    totalInvested,
    totalReturn,
    advantageOfSurrender,
    multipleVsMaturity,
    surrenderIsBetter: advantageOfSurrender > 0,
    continueCashflows,
  };
}
