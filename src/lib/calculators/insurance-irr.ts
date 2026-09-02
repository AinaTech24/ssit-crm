/**
 * Insurance Return Analyzer — math engine (renamed "Insurance IRR Calculator").
 *
 * Computes the true IRR of a traditional/guaranteed insurance policy from its
 * actual cashflows (premiums out, periodic payouts + maturity in), and compares
 * it with investing the same premiums in a mutual fund.
 *
 * Annual cashflow timeline (begin-of-year premiums). The IRR is the annual rate
 * that zeroes the NPV. Verified to the reference case study (₹1L premium × 10y,
 * 15y term, ₹17.5L maturity → IRR 5.36%; same premiums in MF @12% → ₹34.63L;
 * MF contribution to match the ₹17.5L maturity → ₹50,522/yr).
 */

export type PayoutMode = "maturity" | "periodic" | "annuity";

export type Payout = { year: number; amount: number };

export type InsuranceIrrInput = {
  annualPremium: number;
  premiumPaymentTerm: number; // years premiums are paid
  policyTerm: number; // total policy duration (maturity year)
  payoutMode: PayoutMode;
  payouts: Payout[]; // periodic / annuity payouts (year + amount)
  maturityAmount: number; // lump sum at end of policy term
  expectedReturnPct: number; // for the MF comparison
};

/* ───────────────────────── NPV / IRR ───────────────────────── */

export function npv(cashflows: number[], rate: number): number {
  let v = 0;
  for (let t = 0; t < cashflows.length; t++) v += cashflows[t] / Math.pow(1 + rate, t);
  return v;
}

/** Annual IRR of a yearly cashflow array (index = year). null if none exists. */
export function irr(cashflows: number[]): number | null {
  const hasPos = cashflows.some((c) => c > 0);
  const hasNeg = cashflows.some((c) => c < 0);
  if (!hasPos || !hasNeg) return null;

  let lo = -0.9999;
  let hi = 1.0;
  let fLo = npv(cashflows, lo);
  let fHi = npv(cashflows, hi);
  let guard = 0;
  while (fLo * fHi > 0 && hi < 1000 && guard < 300) {
    hi *= 1.5;
    fHi = npv(cashflows, hi);
    guard++;
  }
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(cashflows, mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

/* ───────────────────────── Aggregate ───────────────────────── */

export type InsuranceIrrResult = {
  totalPremiums: number;
  totalPayouts: number;
  maturityAmount: number;
  totalBenefit: number; // payouts + maturity
  netGain: number; // benefit − premiums
  irrPct: number | null;
  cashflows: number[]; // yearly, for an optional schedule view
  // MF comparison (same premiums invested at expectedReturnPct)
  mfMaturity: number;
  mfWealthAdvantage: number; // mfMaturity − totalBenefit
  mfAdvantagePct: number | null; // advantage as % of insurance benefit
  mfContributionToMatch: number; // annual MF SIP/contribution to reach totalBenefit
};

export function computeInsuranceIrr(input: InsuranceIrrInput): InsuranceIrrResult {
  const ppt = Math.max(0, Math.round(input.premiumPaymentTerm));
  const term = Math.max(ppt, Math.round(input.policyTerm));
  const R = input.expectedReturnPct / 100;

  const usePayouts = input.payoutMode !== "maturity";
  const payouts = usePayouts
    ? (input.payouts ?? []).filter((p) => p.year > 0 && p.year <= term && p.amount > 0)
    : [];

  // Build the yearly cashflow timeline (t = 0 … term).
  const cashflows = new Array(term + 1).fill(0);
  for (let t = 0; t < ppt; t++) cashflows[t] -= input.annualPremium; // begin-of-year premiums
  for (const p of payouts) cashflows[p.year] += p.amount;
  cashflows[term] += input.maturityAmount;

  const totalPremiums = input.annualPremium * ppt;
  const totalPayouts = payouts.reduce((s, p) => s + p.amount, 0);
  const totalBenefit = totalPayouts + input.maturityAmount;
  const netGain = totalBenefit - totalPremiums;
  const irrPct = irr(cashflows);

  // MF: invest the same premiums at R (begin-of-year), grow to maturity year.
  let mfMaturity = 0;
  let fvFactorPerRupee = 0;
  for (let t = 0; t < ppt; t++) {
    const growth = Math.pow(1 + R, term - t);
    mfMaturity += input.annualPremium * growth;
    fvFactorPerRupee += growth;
  }

  const mfWealthAdvantage = mfMaturity - totalBenefit;
  const mfAdvantagePct = totalBenefit > 0 ? (mfWealthAdvantage / totalBenefit) * 100 : null;
  const mfContributionToMatch = fvFactorPerRupee > 0 ? totalBenefit / fvFactorPerRupee : 0;

  return {
    totalPremiums,
    totalPayouts,
    maturityAmount: input.maturityAmount,
    totalBenefit,
    netGain,
    irrPct: irrPct === null ? null : irrPct * 100,
    cashflows,
    mfMaturity,
    mfWealthAdvantage,
    mfAdvantagePct,
    mfContributionToMatch,
  };
}
