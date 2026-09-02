/**
 * Recover Your EMIs through SIP — math engine (EMI ↔ SIP planner).
 *
 * A client paying a loan EMI can run a parallel SIP that, by the end of the loan
 * tenure, grows to the TOTAL amount they'll have repaid (principal + interest) —
 * effectively "recovering" every rupee of EMI. This sizes that SIP.
 *
 * Two input modes:
 *   • "loan" — enter loan amount, interest rate & tenure → we compute the EMI,
 *              the principal / interest / total repayment, then the SIP needed.
 *   • "emi"  — enter the EMI directly (no loan maths) → total repayment = EMI ×
 *              months, then the SIP needed.
 *
 * CONVENTIONS — EMI uses the standard reducing-balance formula (interest
 * compounded monthly, EMI paid at month end). The recovery SIP uses the
 * EFFECTIVE monthly rate, BEGIN-mode. Calibrated to the reference case study:
 *   loan ₹25,00,000 · 9% · 15 yrs · SIP 12% → EMI ₹25,357 · total ₹45,64,200 ·
 *   SIP ₹9,590 (37.82% of the EMI).
 */

export type EmiSipMode = "loan" | "emi";

export type EmiSipInput = {
  mode: EmiSipMode;
  // loan mode
  loanAmount: number;
  interestRatePct: number;
  // emi mode
  emiAmount: number;
  // common
  tenureMonths: number;
  sipReturnPct: number;
};

export type EmiSipResult = {
  monthlyEmi: number;
  principalRepayment: number | null; // null in emi mode (unknown without rate)
  interestRepayment: number | null;
  totalRepayment: number;
  monthlySipRequired: number;
  sipAsPctOfEmi: number;
  sipTotalInvested: number;
  sipWealthGain: number;
};

/** Standard reducing-balance EMI. */
export function computeEmi(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/** Monthly SIP (begin-mode, effective rate) needed to accumulate `target`. */
function requiredSipBegin(target: number, annualRatePct: number, months: number): number {
  if (months <= 0 || target <= 0) return 0;
  const m = Math.pow(1 + annualRatePct / 100, 1 / 12) - 1;
  if (m === 0) return target / months;
  const factor = ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
  return target / factor;
}

export function computeEmiSip(input: EmiSipInput): EmiSipResult {
  const n = Math.max(0, Math.round(input.tenureMonths));

  let monthlyEmi: number;
  let principalRepayment: number | null;
  let interestRepayment: number | null;
  let totalRepayment: number;

  if (input.mode === "loan") {
    monthlyEmi = computeEmi(input.loanAmount, input.interestRatePct, n);
    totalRepayment = monthlyEmi * n;
    principalRepayment = input.loanAmount;
    interestRepayment = totalRepayment - input.loanAmount;
  } else {
    monthlyEmi = input.emiAmount;
    totalRepayment = input.emiAmount * n;
    principalRepayment = null;
    interestRepayment = null;
  }

  const monthlySipRequired = requiredSipBegin(totalRepayment, input.sipReturnPct, n);
  const sipAsPctOfEmi = monthlyEmi > 0 ? (monthlySipRequired / monthlyEmi) * 100 : 0;
  const sipTotalInvested = monthlySipRequired * n;

  return {
    monthlyEmi,
    principalRepayment,
    interestRepayment,
    totalRepayment,
    monthlySipRequired,
    sipAsPctOfEmi,
    sipTotalInvested,
    sipWealthGain: totalRepayment - sipTotalInvested,
  };
}
