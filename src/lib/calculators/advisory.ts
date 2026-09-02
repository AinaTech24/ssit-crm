/**
 * Math for the "wow-service" advisory calculators (Packs A–D). Pure functions,
 * reusing the verified goal-planning helpers. No UI, no data fetching.
 */

import { fvSip, fvLumpsum, inflatedTarget, requiredSip } from "@/lib/goal-planning/calc";

/** Future value of an annual annuity-due (contribution at the start of each year). */
function fvAnnualDue(amount: number, ratePct: number, years: number): number {
  if (amount <= 0 || years <= 0) return 0;
  const r = ratePct / 100;
  if (r === 0) return amount * years;
  return amount * ((Math.pow(1 + r, years) - 1) / r) * (1 + r);
}

/* ── A1. Loan Prepay vs Invest ── */
export function prepayVsInvest(p: {
  outstanding: number;
  loanRatePct: number;
  remainingMonths: number;
  surplusMonthly: number;
  investReturnPct: number;
}) {
  const r = p.loanRatePct / 100 / 12;
  const inv = p.investReturnPct / 100 / 12;
  const H = Math.max(0, Math.round(p.remainingMonths));
  const emi = H === 0 ? 0 : r === 0 ? p.outstanding / H : (p.outstanding * r) / (1 - Math.pow(1 + r, -H));

  // PREPAY: pay EMI + surplus until the loan closes, then invest (EMI + surplus) for the freed months.
  let bal = p.outstanding;
  let prepayInterest = 0;
  let m = 0;
  while (bal > 0 && m < H) {
    const interest = bal * r;
    prepayInterest += interest;
    bal = bal - (emi + p.surplusMonthly - interest);
    m++;
  }
  const loanClosedMonth = Math.min(m, H);
  let prepayCorpus = 0;
  for (let k = 0; k < H - loanClosedMonth; k++) prepayCorpus = prepayCorpus * (1 + inv) + (emi + p.surplusMonthly);

  // INVEST: pay EMI normally (loan closes at H), invest the surplus every month.
  let investCorpus = 0;
  for (let k = 0; k < H; k++) investCorpus = investCorpus * (1 + inv) + p.surplusMonthly;

  const normalInterest = emi * H - p.outstanding;
  return {
    emi,
    prepayCorpus,
    investCorpus,
    winner: prepayCorpus >= investCorpus ? ("prepay" as const) : ("invest" as const),
    interestSaved: Math.max(0, normalInterest - prepayInterest),
    monthsSaved: Math.max(0, H - loanClosedMonth),
    gap: Math.abs(prepayCorpus - investCorpus),
  };
}

/* ── A2. BTID: Term + MF vs ULIP/Endowment ── */
export function btid(p: {
  annualBudget: number;
  termAnnualPremium: number;
  termCover: number;
  years: number;
  mfReturnPct: number;
  tradReturnPct: number;
  tradCoverMultiple?: number;
}) {
  const investable = Math.max(0, p.annualBudget - p.termAnnualPremium);
  const btidCorpus = fvAnnualDue(investable, p.mfReturnPct, p.years);
  const tradCorpus = fvAnnualDue(p.annualBudget, p.tradReturnPct, p.years);
  const tradCover = p.annualBudget * (p.tradCoverMultiple ?? 10);
  return {
    investable,
    btidCorpus,
    tradCorpus,
    btidCover: p.termCover,
    tradCover,
    wealthGap: btidCorpus - tradCorpus,
    coverGap: p.termCover - tradCover,
  };
}

/* ── A3. NPS vs Mutual Fund ── */
export function npsVsMf(p: {
  monthly: number;
  years: number;
  npsReturnPct: number;
  mfReturnPct: number;
  annuityRatePct: number;
  taxSlabPct: number;
}) {
  const months = Math.round(p.years * 12);
  const npsCorpus = fvSip(p.monthly, p.npsReturnPct, months);
  const mfCorpus = fvSip(p.monthly, p.mfReturnPct, months);
  const npsLumpsum = npsCorpus * 0.6; // 60% tax-free at 60
  const npsAnnuityCorpus = npsCorpus * 0.4; // 40% mandatory annuity
  const npsMonthlyPension = (npsAnnuityCorpus * (p.annuityRatePct / 100)) / 12;
  // Extra 80CCD(1B) benefit, capped at ₹50k/yr.
  const annualNpsTaxSaved = Math.min(p.monthly * 12, 50000) * (p.taxSlabPct / 100);
  return { npsCorpus, mfCorpus, npsLumpsum, npsAnnuityCorpus, npsMonthlyPension, annualNpsTaxSaved };
}

/* ── B4. Passive Income / Financial-Freedom Builder ── */
export function passiveIncome(p: {
  targetMonthlyToday: number;
  inflationPct: number;
  postReturnPct: number;
  yearsToFreedom: number;
  existingCorpus: number;
  buildReturnPct: number;
  payoutYears: number; // 0 = perpetual (never touch principal)
}) {
  const futureMonthly = inflatedTarget(p.targetMonthlyToday, p.inflationPct, p.yearsToFreedom);
  const annual = futureMonthly * 12;
  const r = p.postReturnPct / 100;
  const infl = p.inflationPct / 100;
  const real = (1 + r) / (1 + infl) - 1;
  let corpusNeeded: number;
  if (p.payoutYears <= 0) {
    corpusNeeded = real > 0 ? annual / real : annual * 100; // inflation-protected perpetuity
  } else {
    const n = p.payoutYears;
    corpusNeeded = real === 0 ? annual * n : annual * (1 + real) * ((1 - Math.pow(1 + real, -n)) / real);
  }
  const months = Math.round(p.yearsToFreedom * 12);
  const sip = months > 0 ? requiredSip(corpusNeeded, p.existingCorpus, p.buildReturnPct, months) : 0;
  return { futureMonthly, corpusNeeded, requiredSip: Math.max(0, sip) };
}

/* ── B5. Dream Wedding Planner (and any inflated lump goal) ── */
export function inflatedGoalSip(p: {
  costToday: number;
  years: number;
  inflationPct: number;
  existingSavings: number;
  returnPct: number;
}) {
  const futureCost = inflatedTarget(p.costToday, p.inflationPct, p.years);
  const months = Math.round(p.years * 12);
  const sip = months > 0 ? requiredSip(futureCost, p.existingSavings, p.returnPct, months) : 0;
  return { futureCost, requiredSip: Math.max(0, sip), months };
}

/* ── B6. Dream Car — Invest First vs Auto-loan ── */
export function dreamCar(p: {
  carPriceToday: number;
  yearsToBuy: number;
  carInflationPct: number;
  investReturnPct: number;
  downPaymentPct: number;
  loanRatePct: number;
  loanYears: number;
}) {
  const futurePrice = inflatedTarget(p.carPriceToday, p.carInflationPct, p.yearsToBuy);
  const months = Math.round(p.yearsToBuy * 12);
  const sipToBuyCash = months > 0 ? requiredSip(futurePrice, 0, p.investReturnPct, months) : 0;
  const investedCash = Math.max(0, sipToBuyCash) * months;
  const down = (p.carPriceToday * p.downPaymentPct) / 100;
  const loan = Math.max(0, p.carPriceToday - down);
  const r = p.loanRatePct / 100 / 12;
  const n = Math.round(p.loanYears * 12);
  const emi = n === 0 ? 0 : r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n));
  const loanTotal = down + emi * n;
  const loanInterest = emi * n - loan;
  return { futurePrice, sipToBuyCash: Math.max(0, sipToBuyCash), investedCash, emi, loanTotal, loanInterest, down };
}

/* ── C7. Emergency Fund Planner ── */
export function emergencyFund(p: {
  monthlyExpense: number;
  monthsBuffer: number;
  existing: number;
  buildMonths: number;
  parkReturnPct: number;
}) {
  const target = p.monthlyExpense * p.monthsBuffer;
  const gap = Math.max(0, target - p.existing);
  const sip = p.buildMonths > 0 && gap > 0 ? requiredSip(target, p.existing, p.parkReturnPct, p.buildMonths) : 0;
  return { target, gap, requiredSip: Math.max(0, sip) };
}

/* ── C8. Retirement Bucket Strategy ── */
export function retirementBuckets(p: {
  corpus: number;
  monthlyExpense: number;
  bucket1Years: number;
  bucket2Years: number;
}) {
  const annual = p.monthlyExpense * 12;
  const b1 = Math.min(p.corpus, annual * p.bucket1Years);
  const b2 = Math.min(Math.max(0, p.corpus - b1), annual * p.bucket2Years);
  const b3 = Math.max(0, p.corpus - b1 - b2);
  return {
    b1,
    b2,
    b3,
    total: p.corpus,
    annual,
    yearsCovered: p.bucket1Years + p.bucket2Years,
    b1Pct: p.corpus > 0 ? b1 / p.corpus : 0,
    b2Pct: p.corpus > 0 ? b2 / p.corpus : 0,
    b3Pct: p.corpus > 0 ? b3 / p.corpus : 0,
  };
}

/* ── C9. SIP Pause/Skip Cost ── */
export function sipPauseCost(p: {
  monthlySip: number;
  returnPct: number;
  yearsRemaining: number;
  monthsSkipped: number;
}) {
  const months = Math.round(p.yearsRemaining * 12);
  const skipped = Math.min(p.monthsSkipped, months);
  const miniCorpus = fvSip(p.monthlySip, p.returnPct, skipped);
  const costAtHorizon = fvLumpsum(miniCorpus, p.returnPct, Math.max(0, months - skipped));
  const contributed = p.monthlySip * skipped;
  return { costAtHorizon, contributed, lost: costAtHorizon };
}

/* ── D11. Inflation Time Machine ── */
export function timeMachine(p: { amount: number; fromYear: number; toYear: number; inflationPct: number }) {
  const years = p.toYear - p.fromYear;
  const equivalent = p.amount * Math.pow(1 + p.inflationPct / 100, years);
  return { years, equivalent };
}

/* ── D12. Wealth Doubling (Rule of 72) ── */
export function doublingTimeline(p: { amount: number; returnPct: number; doublings: number }) {
  const k = Math.log(1 + p.returnPct / 100);
  const yearsToDouble = k > 0 ? Math.log(2) / k : Infinity;
  const rule72 = p.returnPct > 0 ? 72 / p.returnPct : Infinity;
  const rows = Array.from({ length: Math.max(1, p.doublings) }, (_, i) => ({
    multiple: Math.pow(2, i + 1),
    years: yearsToDouble * (i + 1),
    value: p.amount * Math.pow(2, i + 1),
  }));
  return { yearsToDouble, rule72, rows };
}
