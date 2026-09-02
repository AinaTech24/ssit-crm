/**
 * Calculators math — a faithful RN port of the web app's calculator engines.
 * Pure formulas, no DB / no React. Numbers must match the web app to the rupee.
 *
 * RATE CONVENTIONS DIFFER PER SECTION — preserved exactly from source:
 *   • goal-planning helpers (fvSip/fvLumpsum/requiredSip, imported from
 *     ../goals/calc) use a NOMINAL monthly rate r/12.
 *   • The SIP-360 family (crash-stress, fire, nps, child-education,
 *     emi-sip recovery SIP, growingSipSchedule) uses an EFFECTIVE monthly
 *     rate (1 + r)^(1/12) − 1.
 * Keep each formula's convention intact — do NOT unify them.
 */

import { fvSip, fvLumpsum, inflatedTarget, requiredSip } from "../goals/calc";

/* ═══════════════════════ Shared helper ═══════════════════════
 * Effective monthly rate from an annual percentage. (Ported from
 * src/lib/calculators/sip360.ts — used by crash-stress, fire, nps and the
 * child-education / goal-collision required-SIP factor.)
 */
export function monthlyRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/* ═══════════════════════ goal-planning/calc.ts ═══════════════════════ */

/* ───────────────── Growing SIP (BIRD calculator) ─────────────────
 * Faithful replica of the "Growing SIP & SIP" workbook. Two differences from
 * the goal-planning helpers, kept intentionally so the numbers MATCH that sheet:
 *   1. Rate: the annual return is treated as EFFECTIVE and converted to a
 *      monthly rate via i = (1+r)^(1/12) − 1  (Excel NOMINAL(r,12)/12),
 *      not the simpler r/12 used elsewhere.
 *   2. Annuity-DUE: contributions are made at the START of each month (type=1).
 * The growing SIP steps the monthly amount up by `annualGrowthPct` each YEAR
 * (constant within the year); the balance compounds across years.
 */
export type SipYearRow = {
  year: number;
  fv: number; // future value at end of this year
  yearCost: number; // contributed during this year
  invested: number; // cumulative contributed
  profit: number; // fv − invested
  profitPctOfCorpus: number; // profit / invested (fraction, e.g. 0.74 = 74%)
};

export type GrowingSipResult = {
  regular: SipYearRow[];
  growing: SipYearRow[];
  monthlyRatePct: number; // the effective monthly rate, × 100
};

export function growingSipSchedule(params: {
  monthlySip: number;
  annualReturnPct: number;
  annualGrowthPct: number;
  years: number;
}): GrowingSipResult {
  const P = Math.max(0, params.monthlySip);
  const years = Math.max(0, Math.floor(params.years));
  const i = Math.pow(1 + params.annualReturnPct / 100, 1 / 12) - 1; // effective → monthly
  const g = params.annualGrowthPct / 100;
  // FV factor for an annuity-due of `n` unit payments at monthly rate i.
  const dueFactor = (n: number) => (i === 0 ? n : ((Math.pow(1 + i, n) - 1) / i) * (1 + i));

  const regular: SipYearRow[] = [];
  const growing: SipYearRow[] = [];

  // Regular SIP — constant monthly amount P.
  for (let y = 1; y <= years; y++) {
    const fv = P * dueFactor(y * 12);
    const invested = P * 12 * y;
    const profit = fv - invested;
    regular.push({
      year: y,
      fv,
      yearCost: P * 12,
      invested,
      profit,
      profitPctOfCorpus: invested > 0 ? profit / invested : 0,
    });
  }

  // Growing SIP — monthly amount steps up by g each year; balance compounds.
  let bal = 0;
  let invested = 0;
  for (let y = 1; y <= years; y++) {
    const monthly = P * Math.pow(1 + g, y - 1);
    bal = bal * Math.pow(1 + i, 12) + monthly * dueFactor(12);
    const yearCost = monthly * 12;
    invested += yearCost;
    const profit = bal - invested;
    growing.push({
      year: y,
      fv: bal,
      yearCost,
      invested,
      profit,
      profitPctOfCorpus: invested > 0 ? profit / invested : 0,
    });
  }

  return { regular, growing, monthlyRatePct: i * 100 };
}

/**
 * Cost of Delay — same SIP, two start ages. How much wealth lost by
 * starting later?
 *
 * lumpsum is optional one-shot at the start; sipAmount runs monthly
 * from startAge to endAge.
 *
 * Rate convention: uses the goal-planning fvSip/fvLumpsum (NOMINAL r/12).
 */
export function costOfDelay(params: {
  sipAmount: number;
  lumpsum?: number;
  startAgeNow: number;
  startAgeLater: number;
  endAge: number;
  returnPct: number;
}): {
  now: { years: number; invested: number; finalValue: number; gain: number };
  later: { years: number; invested: number; finalValue: number; gain: number };
  costOfDelay: number;
} {
  const { sipAmount, lumpsum = 0, startAgeNow, startAgeLater, endAge, returnPct } = params;
  function run(startAge: number) {
    const years = Math.max(0, endAge - startAge);
    const months = years * 12;
    const invested = sipAmount * months + lumpsum;
    const fv = fvSip(sipAmount, returnPct, months) + fvLumpsum(lumpsum, returnPct, months);
    return { years, invested, finalValue: fv, gain: fv - invested };
  }
  const now = run(startAgeNow);
  const later = run(startAgeLater);
  return {
    now,
    later,
    costOfDelay: now.finalValue - later.finalValue,
  };
}

/**
 * Retirement Planning — compute the corpus required at retirement to
 * sustain a monthly income (inflation-adjusted) through life expectancy,
 * then the monthly savings required to build that corpus from now.
 *
 * Two phases:
 *   pre-retirement  — accumulation, monthly SIP at preReturnPct
 *   post-retirement — distribution, corpus draws monthly at postReturnPct
 *
 * Corpus needed = PV of growing annuity (income grows with inflation)
 * over distribution years at postReturnPct.
 *
 * Rate convention: uses the goal-planning fvLumpsum/requiredSip (NOMINAL r/12)
 * for the accumulation side; distribution PV uses NOMINAL monthly r/12 and g/12.
 */
export function retirementCorpus(params: {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  monthlyIncomeTodayInr: number;
  inflationPct: number;
  preReturnPct: number;
  postReturnPct: number;
  existingFundInr: number;
}): {
  preRetirementYears: number;
  distributionYears: number;
  monthlyIncomeAtRetirement: number;
  corpusRequired: number;
  fvOfExistingFund: number;
  monthlySavingsRequired: number;
} {
  const {
    currentAge,
    retirementAge,
    lifeExpectancy,
    monthlyIncomeTodayInr,
    inflationPct,
    preReturnPct,
    postReturnPct,
    existingFundInr,
  } = params;
  const preYears = Math.max(0, retirementAge - currentAge);
  const distYears = Math.max(0, lifeExpectancy - retirementAge);
  const distMonths = distYears * 12;

  // Inflate today's monthly income to its value at retirement
  const monthlyIncomeAtRet = monthlyIncomeTodayInr * Math.pow(1 + inflationPct / 100, preYears);

  // Corpus required: PV at retirement of monthly withdrawals growing
  // at inflation, draw rate = postReturnPct. Closed-form:
  //   PV = P × (1 − ((1+g)/(1+r))^n) / (r − g)
  // where g = monthly inflation, r = monthly return, P = first month's withdrawal.
  const g = inflationPct / 100 / 12;
  const r = postReturnPct / 100 / 12;
  let corpusRequired = 0;
  if (distMonths === 0) {
    corpusRequired = 0;
  } else if (Math.abs(r - g) < 1e-9) {
    // Degenerate — equal growth and return
    corpusRequired = monthlyIncomeAtRet * distMonths;
  } else {
    const ratio = Math.pow((1 + g) / (1 + r), distMonths);
    corpusRequired = (monthlyIncomeAtRet * (1 - ratio)) / (r - g);
  }

  // Existing fund grows for preYears at preReturnPct
  const fvOfExisting = fvLumpsum(existingFundInr, preReturnPct, preYears * 12);
  const shortfall = Math.max(0, corpusRequired - fvOfExisting);
  const monthlySavingsRequired = requiredSip(
    shortfall,
    0,
    preReturnPct,
    preYears * 12
  );

  return {
    preRetirementYears: preYears,
    distributionYears: distYears,
    monthlyIncomeAtRetirement: monthlyIncomeAtRet,
    corpusRequired,
    fvOfExistingFund: fvOfExisting,
    monthlySavingsRequired,
  };
}

/**
 * SWP (Systematic Withdrawal Plan) — given a starting corpus, monthly
 * withdrawal, return, and years, simulate the depletion month-by-month
 * and return the final balance + total withdrawn.
 *
 * Corpus is exhausted partway? finalValue clamps at 0 and totalWithdrawn
 * reflects only what was actually paid out before depletion.
 *
 * Rate convention: NOMINAL monthly rate r/12; withdraw at month start (Begin Mode).
 */
export function swpDeplete(params: {
  corpusInr: number;
  monthlyWithdrawalInr: number;
  returnPct: number;
  years: number;
}): {
  invested: number;
  totalWithdrawn: number;
  finalValue: number;
  monthsBeforeDepletion: number | null;
} {
  const { corpusInr, monthlyWithdrawalInr, returnPct, years } = params;
  const months = years * 12;
  const m = returnPct / 100 / 12;
  let balance = corpusInr;
  let withdrawn = 0;
  let depletedAt: number | null = null;
  for (let i = 0; i < months; i++) {
    // Withdraw at month start (Begin Mode, matching the template note).
    if (balance <= 0) {
      depletedAt = i;
      break;
    }
    const w = Math.min(monthlyWithdrawalInr, balance);
    balance -= w;
    withdrawn += w;
    // Grow remaining balance for the month
    balance = balance * (1 + m);
  }
  return {
    invested: corpusInr,
    totalWithdrawn: withdrawn,
    finalValue: Math.max(0, balance),
    monthsBeforeDepletion: depletedAt,
  };
}

/* ───────────────────────── STP & CAGR Calculators ───────────────────────── */

export interface StpResult {
  invested: number;
  sourceFinalValue: number;
  targetFinalValue: number;
  totalFinalValue: number;
  gain: number;
}

/** Rate convention: NOMINAL monthly rate r/12 for both source and target legs. */
export function stpCalculate(params: {
  lumpsum: number;
  transferAmount: number;
  sourceReturnPct: number;
  targetReturnPct: number;
  years: number;
}): StpResult {
  const { lumpsum, transferAmount, sourceReturnPct, targetReturnPct, years } = params;
  const months = years * 12;
  const mSource = sourceReturnPct / 100 / 12;
  const mTarget = targetReturnPct / 100 / 12;

  let balanceSource = lumpsum;
  let balanceTarget = 0;

  for (let i = 0; i < months; i++) {
    if (balanceSource > 0) {
      const transfer = Math.min(transferAmount, balanceSource);
      balanceSource -= transfer;
      balanceTarget += transfer;
    }
    balanceSource = balanceSource * (1 + mSource);
    balanceTarget = balanceTarget * (1 + mTarget);
  }

  const totalFinalValue = balanceSource + balanceTarget;

  return {
    invested: lumpsum,
    sourceFinalValue: balanceSource,
    targetFinalValue: balanceTarget,
    totalFinalValue,
    gain: Math.max(0, totalFinalValue - lumpsum),
  };
}

export interface CagrResult {
  cagrPct: number;
  absoluteReturnPct: number;
}

export function cagrCalculate(params: {
  initialValue: number;
  finalValue: number;
  years: number;
}): CagrResult {
  const { initialValue, finalValue, years } = params;
  if (initialValue <= 0 || years <= 0) {
    return { cagrPct: 0, absoluteReturnPct: 0 };
  }
  const absoluteReturnPct = ((finalValue - initialValue) / initialValue) * 100;
  const cagr = Math.pow(finalValue / initialValue, 1 / years) - 1;
  return {
    cagrPct: cagr * 100,
    absoluteReturnPct,
  };
}

/* ═══════════════════════ calculators/conversion.ts ═══════════════════════
 * Rate convention: uses the goal-planning fvSip/fvLumpsum/requiredSip
 * (annuity-due monthly compounder, NOMINAL r/12).
 */

/** Months until (lumpsum grown + SIP) first reaches `target`. null if never within maxYears. */
export function monthsToTarget(p: {
  monthlySip: number;
  lumpsum: number;
  annualReturnPct: number;
  target: number;
  maxYears?: number;
}): number | null {
  if (p.target <= 0) return 0;
  const max = Math.round((p.maxYears ?? 60) * 12);
  for (let m = 0; m <= max; m++) {
    const fv = fvLumpsum(p.lumpsum, p.annualReturnPct, m) + fvSip(p.monthlySip, p.annualReturnPct, m);
    if (fv >= p.target) return m;
  }
  return null;
}

/** A future date `months` from `from`, as {label, iso}. */
export function dateAfterMonths(from: Date, months: number): { label: string; iso: string } {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return { label, iso: d.toISOString().slice(0, 10) };
}

/* ── 3. Rent vs Buy + Invest the Difference ── */
export function rentVsBuy(p: {
  homePrice: number;
  downPaymentPct: number;
  loanRatePct: number;
  loanYears: number;
  homeAppreciationPct: number;
  maintenancePctPerYear: number;
  monthlyRent: number;
  rentInflationPct: number;
  equityReturnPct: number;
  horizonYears: number;
}) {
  const down = (p.homePrice * p.downPaymentPct) / 100;
  const loan = Math.max(0, p.homePrice - down);
  const r = p.loanRatePct / 100 / 12;
  const n = Math.round(p.loanYears * 12);
  const emi = n === 0 ? 0 : r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n));
  const Hm = Math.round(p.horizonYears * 12);

  // BUY — net worth = appreciated home value − outstanding loan.
  const homeValue = p.homePrice * Math.pow(1 + p.homeAppreciationPct / 100, p.horizonYears);
  let bal = loan;
  const monthsPaid = Math.min(Hm, n);
  for (let m = 0; m < monthsPaid; m++) {
    const interest = bal * r;
    bal = bal - (emi - interest);
  }
  const outstanding = Hm >= n ? 0 : Math.max(0, bal);
  const buyNetWorth = homeValue - outstanding;

  // RENT + INVEST the difference — invest the down-payment as a lumpsum, then
  // each month invest whatever the owner spends above the renter (EMI +
  // maintenance − rent). Rent escalates annually.
  const eqM = p.equityReturnPct / 100 / 12;
  const maintenanceMonthly = (p.homePrice * (p.maintenancePctPerYear / 100)) / 12;
  let invest = down;
  let rent = p.monthlyRent;
  const buySeries: { year: number; value: number }[] = [{ year: 0, value: down }];
  const rentSeries: { year: number; value: number }[] = [{ year: 0, value: down }];
  let runBal = loan;
  for (let m = 0; m < Hm; m++) {
    if (m > 0 && m % 12 === 0) rent = rent * (1 + p.rentInflationPct / 100);
    const ownerOutflow = (m < n ? emi : 0) + maintenanceMonthly;
    const surplus = ownerOutflow - rent;
    invest = invest * (1 + eqM) + (surplus > 0 ? surplus : 0);
    // track owner equity over time for the chart
    if (m < n) {
      const interest = runBal * r;
      runBal = runBal - (emi - interest);
    }
    if ((m + 1) % 12 === 0) {
      const yr = (m + 1) / 12;
      const hv = p.homePrice * Math.pow(1 + p.homeAppreciationPct / 100, yr);
      buySeries.push({ year: yr, value: hv - Math.max(0, runBal) });
      rentSeries.push({ year: yr, value: invest });
    }
  }
  const rentNetWorth = invest;
  return {
    emi,
    homeValue,
    outstanding,
    buyNetWorth,
    rentNetWorth,
    maintenanceMonthly,
    winner: buyNetWorth >= rentNetWorth ? ("buy" as const) : ("rent" as const),
    buySeries,
    rentSeries,
  };
}

/* ── 4. FD vs Equity Wealth Gap ── */
export function fdVsEquity(p: {
  lumpsum: number;
  monthlySip: number;
  years: number;
  fdRatePct: number;
  equityRatePct: number;
}) {
  const months = Math.round(p.years * 12);
  const at = (rate: number, m: number) => fvLumpsum(p.lumpsum, rate, m) + fvSip(p.monthlySip, rate, m);
  const invested = p.lumpsum + p.monthlySip * months;
  const series: { year: number; fd: number; eq: number }[] = [];
  for (let y = 0; y <= p.years; y++) {
    const m = y * 12;
    series.push({ year: y, fd: at(p.fdRatePct, m), eq: at(p.equityRatePct, m) });
  }
  const fd = at(p.fdRatePct, months);
  const eq = at(p.equityRatePct, months);
  return { fd, eq, gap: eq - fd, invested, series };
}

/* ── 8. ₹1 Crore Race ── */
export function croreRace(p: {
  sipAmounts: number[];
  lumpsum: number;
  annualReturnPct: number;
  target: number;
}) {
  return p.sipAmounts.map((sip) => ({
    sip,
    months: monthsToTarget({
      monthlySip: sip,
      lumpsum: p.lumpsum,
      annualReturnPct: p.annualReturnPct,
      target: p.target,
    }),
  }));
}

/* ═══════════════════════ calculators/advisory.ts ═══════════════════════ */

/** Future value of an annual annuity-due (contribution at the start of each year). */
function fvAnnualDue(amount: number, ratePct: number, years: number): number {
  if (amount <= 0 || years <= 0) return 0;
  const r = ratePct / 100;
  if (r === 0) return amount * years;
  return amount * ((Math.pow(1 + r, years) - 1) / r) * (1 + r);
}

/* ── A2. BTID: Term + MF vs ULIP/Endowment ──
 * Rate convention: annual annuity-due (fvAnnualDue). */
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

/* ── C7. Emergency Fund Planner ──
 * Rate convention: goal-planning requiredSip (NOMINAL r/12). */
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

/* ── D12. Wealth Doubling (Rule of 72) ──
 * Rate convention: continuous/annual log doubling time + the Rule-of-72 rule. */
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

/* ═══════════════════════ calculators/emi-sip.ts ═══════════════════════
 * EMI uses the standard reducing-balance formula (interest compounded monthly,
 * EMI paid at month end). The recovery SIP uses the EFFECTIVE monthly rate,
 * BEGIN-mode.
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

/** Monthly SIP (begin-mode, EFFECTIVE rate) needed to accumulate `target`. */
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

/* ═══════════════════════ calculators/crash-stress.ts ═══════════════════════
 * Convention: EFFECTIVE monthly rate (monthlyRate), SIP at month start (begin
 * mode); the crash is a one-time shock applied at the end of the crash year's month.
 */

export type CrashStressInput = {
  monthlySip: number;
  lumpsum: number;
  years: number;
  expectedReturnPct: number;
  crashYear: number; // the year the crash hits
  crashPct: number; // drop, e.g. 40
  fdRatePct: number; // where a panicker parks the money
};

export type CrashPoint = { month: number; stay: number; noCrash: number; panic: number };

export type CrashStressResult = {
  totalInvested: number;
  finalStay: number;
  finalNoCrash: number;
  finalPanic: number;
  costOfPanic: number;
  crashDropAmount: number;
  recoveryMonths: number | null;
  series: CrashPoint[]; // yearly snapshots
};

export function computeCrashStress(input: CrashStressInput): CrashStressResult {
  const m = monthlyRate(input.expectedReturnPct);
  const mFd = monthlyRate(input.fdRatePct);
  const n = Math.max(0, Math.round(input.years * 12));
  const crashMonth = Math.max(1, Math.round(input.crashYear * 12));

  let stay = input.lumpsum;
  let noCrash = input.lumpsum;
  let panic = input.lumpsum;
  let panicked = false;
  let invested = input.lumpsum;
  let preCrashPeak = 0;
  let recoveryMonths: number | null = null;
  let crashDropAmount = 0;

  const series: CrashPoint[] = [{ month: 0, stay, noCrash, panic }];

  for (let i = 1; i <= n; i++) {
    // SIP at month start, then grow.
    stay += input.monthlySip;
    noCrash += input.monthlySip;
    panic += input.monthlySip;
    invested += input.monthlySip;

    stay *= 1 + m;
    noCrash *= 1 + m;
    panic *= panicked ? 1 + mFd : 1 + m;

    if (i === crashMonth) {
      preCrashPeak = stay;
      crashDropAmount = stay * (input.crashPct / 100);
      stay *= 1 - input.crashPct / 100;
      // Panic seller redeems at the bottom and moves to cash/FD.
      panic *= 1 - input.crashPct / 100;
      panicked = true;
    }

    if (panicked && recoveryMonths === null && i > crashMonth && stay >= preCrashPeak) {
      recoveryMonths = i - crashMonth;
    }

    if (i % 12 === 0 || i === n) series.push({ month: i, stay, noCrash, panic });
  }

  return {
    totalInvested: invested,
    finalStay: stay,
    finalNoCrash: noCrash,
    finalPanic: panic,
    costOfPanic: Math.max(0, stay - panic),
    crashDropAmount,
    recoveryMonths,
    series,
  };
}

/* ═══════════════════════ calculators/fire.ts ═══════════════════════
 * Convention: EFFECTIVE monthly rate for accumulation; annual model for the
 * sustainability check.
 */

export type FireInput = {
  currentAge: number;
  monthlyExpenseNow: number;
  inflationPct: number;
  preReturnPct: number; // accumulation
  postReturnPct: number; // withdrawal phase
  currentCorpus: number;
  monthlySip: number;
  sipStepUpPct: number;
  swrPct: number; // safe withdrawal rate, e.g. 4
  lifeExpectancy: number;
};

export type FireResult = {
  fireNumberToday: number; // annual expense now / SWR
  fireAge: number | null; // earliest age corpus ≥ inflation-adjusted FIRE number
  fireCorpus: number | null; // required corpus at the FIRE age
  corpusAtFire: number | null; // projected corpus at the FIRE age
  yearsToFire: number | null;
  sustainsToLifeExpectancy: boolean;
  shortfallAge: number | null; // age the corpus would run out, if it does
};

function projectedCorpus(input: FireInput, years: number): number {
  const m = monthlyRate(input.preReturnPct);
  let corpus = input.currentCorpus * Math.pow(1 + m, years * 12);
  let monthly = input.monthlySip;
  for (let y = 0; y < years; y++) {
    if (y > 0) monthly *= 1 + input.sipStepUpPct / 100;
    for (let mo = 0; mo < 12; mo++) {
      const remaining = (years - y) * 12 - mo;
      corpus += monthly * Math.pow(1 + m, remaining);
    }
  }
  return corpus;
}

/** Does `corpus` sustain inflation-rising annual expenses to life expectancy? */
function sustainabilityCheck(
  corpus: number,
  annualExpenseAtStart: number,
  postReturnPct: number,
  inflationPct: number,
  startAge: number,
  lifeExpectancy: number
): { ok: boolean; shortfallAge: number | null } {
  const r = postReturnPct / 100;
  const g = inflationPct / 100;
  let bal = corpus;
  let expense = annualExpenseAtStart;
  for (let age = startAge; age < lifeExpectancy; age++) {
    bal -= expense; // withdraw at year start
    if (bal < 0) return { ok: false, shortfallAge: age };
    bal *= 1 + r;
    expense *= 1 + g;
  }
  return { ok: true, shortfallAge: null };
}

export function computeFire(input: FireInput): FireResult {
  const annualExpenseNow = input.monthlyExpenseNow * 12;
  const swr = input.swrPct / 100;
  const fireNumberToday = swr > 0 ? annualExpenseNow / swr : 0;

  let fireAge: number | null = null;
  let fireCorpus: number | null = null;
  let corpusAtFire: number | null = null;
  let yearsToFire: number | null = null;

  const maxYears = Math.max(0, input.lifeExpectancy - input.currentAge);
  for (let y = 0; y <= maxYears; y++) {
    const age = input.currentAge + y;
    const expenseAtAge = annualExpenseNow * Math.pow(1 + input.inflationPct / 100, y);
    const requiredFire = swr > 0 ? expenseAtAge / swr : Infinity;
    const corpus = projectedCorpus(input, y);
    if (corpus >= requiredFire) {
      fireAge = age;
      fireCorpus = requiredFire;
      corpusAtFire = corpus;
      yearsToFire = y;
      break;
    }
  }

  let sustainsToLifeExpectancy = false;
  let shortfallAge: number | null = null;
  if (fireAge !== null && corpusAtFire !== null) {
    const annualExpenseAtFire = annualExpenseNow * Math.pow(1 + input.inflationPct / 100, yearsToFire ?? 0);
    const chk = sustainabilityCheck(corpusAtFire, annualExpenseAtFire, input.postReturnPct, input.inflationPct, fireAge, input.lifeExpectancy);
    sustainsToLifeExpectancy = chk.ok;
    shortfallAge = chk.shortfallAge;
  }

  return {
    fireNumberToday,
    fireAge,
    fireCorpus,
    corpusAtFire,
    yearsToFire,
    sustainsToLifeExpectancy,
    shortfallAge,
  };
}

/* ═══════════════════════ calculators/nps.ts ═══════════════════════
 * Convention: EFFECTIVE monthly rate, contributions at month start (begin
 * mode), annual step-up applied each year.
 */

export type NpsInput = {
  currentAge: number;
  retirementAge: number;
  monthlyContribution: number;
  annualStepUpPct: number;
  expectedReturnPct: number;
  existingCorpus: number;
  annuityPortionPct: number; // ≥ 40
  annuityRatePct: number; // pension rate on the annuity corpus
  taxSlabPct: number; // for the 80CCD(1B) benefit
};

export type NpsResult = {
  years: number;
  corpus: number;
  totalContributed: number;
  lumpSum: number; // tax-free withdrawal
  annuityCorpus: number;
  monthlyPension: number;
  annual80CCD1BBenefit: number; // tax saved this year on the extra ₹50k
};

export function computeNps(input: NpsInput): NpsResult {
  const years = Math.max(0, Math.round(input.retirementAge - input.currentAge));
  const m = monthlyRate(input.expectedReturnPct);

  // Stepped-up monthly contributions, begin mode, month-granular.
  let corpus = input.existingCorpus * Math.pow(1 + m, years * 12);
  let totalContributed = 0;
  let monthly = input.monthlyContribution;
  for (let y = 0; y < years; y++) {
    if (y > 0) monthly *= 1 + input.annualStepUpPct / 100;
    for (let mo = 0; mo < 12; mo++) {
      const monthsRemaining = (years - y) * 12 - mo;
      corpus += monthly * Math.pow(1 + m, monthsRemaining);
      totalContributed += monthly;
    }
  }

  const annuityPortion = Math.min(100, Math.max(40, input.annuityPortionPct)) / 100;
  const annuityCorpus = corpus * annuityPortion;
  const lumpSum = corpus - annuityCorpus;
  const monthlyPension = (annuityCorpus * (input.annuityRatePct / 100)) / 12;
  const annual80CCD1BBenefit = 50000 * (input.taxSlabPct / 100);

  return {
    years,
    corpus,
    totalContributed,
    lumpSum,
    annuityCorpus,
    monthlyPension,
    annual80CCD1BBenefit,
  };
}

/* ═══════════════════════ calculators/child-education.ts ═══════════════════════
 * Convention: future cost compounds at education inflation; required SIP uses an
 * EFFECTIVE-monthly annuity-due factor (requiredMonthlySip, ported inline from
 * src/lib/calculators/goal-collision.ts).
 */

/** Monthly SIP to reach `futureCost` in `years` at `ratePct` (begin mode). */
export function requiredMonthlySip(futureCost: number, ratePct: number, years: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (months <= 0) return futureCost;
  const m = monthlyRate(ratePct);
  const factor = m === 0 ? months : ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
  return factor > 0 ? futureCost / factor : 0;
}

export type EduMilestone = {
  name: string;
  childAgeAtStart: number; // age when this course begins
  currentCost: number; // today's cost of the course
};

export type ChildEducationInput = {
  childCurrentAge: number;
  eduInflationPct: number;
  expectedReturnPct: number;
  existingSavings: number; // already earmarked for education
  milestones: EduMilestone[];
};

export type EduMilestoneResult = {
  name: string;
  yearsAway: number;
  futureCost: number;
  monthlySip: number;
  lumpsum: number;
};

export type ChildEducationResult = {
  milestones: EduMilestoneResult[];
  totalFutureCost: number;
  totalMonthlySip: number;
  totalLumpsum: number;
  existingSavingsFutureValue: number; // grown to the nearest milestone
  netAfterSavings: number;
};

export function computeChildEducation(input: ChildEducationInput): ChildEducationResult {
  const r = input.expectedReturnPct / 100;
  const g = input.eduInflationPct / 100;

  const sorted = [...input.milestones].sort((a, b) => a.childAgeAtStart - b.childAgeAtStart);
  const nearestYears = sorted.length ? Math.max(0, sorted[0].childAgeAtStart - input.childCurrentAge) : 0;
  const existingSavingsFutureValue = input.existingSavings * Math.pow(1 + r, nearestYears);

  // Earmarked savings are applied nearest-milestone first. Track the UNUSED
  // portion in TODAY's rupees and grow it to EACH milestone's own date, so a
  // later milestone's offset earns the extra years of compounding (the previous
  // code grew everything only to the nearest milestone, understating later offsets).
  let remainingSavingsToday = input.existingSavings;
  const milestones: EduMilestoneResult[] = sorted.map((mlt) => {
    const yearsAway = Math.max(0, mlt.childAgeAtStart - input.childCurrentAge);
    const grow = Math.pow(1 + r, yearsAway);
    const grossFuture = mlt.currentCost * Math.pow(1 + g, yearsAway);
    const availableAtMilestone = remainingSavingsToday * grow;
    const offset = Math.min(availableAtMilestone, grossFuture);
    remainingSavingsToday -= offset / grow; // consume in present-value terms
    const netFuture = Math.max(0, grossFuture - offset);
    return {
      name: mlt.name,
      yearsAway,
      futureCost: grossFuture,
      monthlySip: requiredMonthlySip(netFuture, input.expectedReturnPct, yearsAway),
      lumpsum: yearsAway > 0 ? netFuture / grow : netFuture,
    };
  });

  const totalFutureCost = milestones.reduce((s, m) => s + m.futureCost, 0);
  const totalMonthlySip = milestones.reduce((s, m) => s + m.monthlySip, 0);
  const totalLumpsum = milestones.reduce((s, m) => s + m.lumpsum, 0);

  return {
    milestones,
    totalFutureCost,
    totalMonthlySip,
    totalLumpsum,
    existingSavingsFutureValue,
    netAfterSavings: Math.max(0, totalFutureCost - existingSavingsFutureValue),
  };
}

/* ═══════════════════════ Reference cases (source provenance) ═══════════════════════
 * Each ported symbol with the source file it was copied from VERBATIM. No
 * fabricated expected numbers — verify against the web app at runtime.
 *
 *   growingSipSchedule    ← src/lib/goal-planning/calc.ts  (effective monthly rate, annuity-due)
 *   costOfDelay           ← src/lib/goal-planning/calc.ts  (nominal r/12 via goals fvSip/fvLumpsum)
 *   retirementCorpus      ← src/lib/goal-planning/calc.ts  (nominal r/12; growing-annuity PV)
 *   swpDeplete            ← src/lib/goal-planning/calc.ts  (nominal r/12; begin-mode withdrawal)
 *   stpCalculate          ← src/lib/goal-planning/calc.ts  (nominal r/12; month-by-month transfer)
 *   cagrCalculate         ← src/lib/goal-planning/calc.ts  (annual CAGR + absolute return)
 *   monthsToTarget        ← src/lib/calculators/conversion.ts
 *   dateAfterMonths       ← src/lib/calculators/conversion.ts
 *   rentVsBuy             ← src/lib/calculators/conversion.ts
 *   fdVsEquity            ← src/lib/calculators/conversion.ts
 *   croreRace             ← src/lib/calculators/conversion.ts
 *   btid                  ← src/lib/calculators/advisory.ts  (+ fvAnnualDue helper, inline)
 *   emergencyFund         ← src/lib/calculators/advisory.ts
 *   doublingTimeline      ← src/lib/calculators/advisory.ts
 *   computeEmi            ← src/lib/calculators/emi-sip.ts
 *   computeEmiSip         ← src/lib/calculators/emi-sip.ts  (+ requiredSipBegin helper, inline)
 *   computeCrashStress    ← src/lib/calculators/crash-stress.ts  (monthlyRate)
 *   computeFire           ← src/lib/calculators/fire.ts  (+ projectedCorpus / sustainabilityCheck, inline)
 *   computeNps            ← src/lib/calculators/nps.ts  (monthlyRate)
 *   computeChildEducation ← src/lib/calculators/child-education.ts  (+ requiredMonthlySip, inline from goal-collision.ts)
 *   monthlyRate           ← src/lib/calculators/sip360.ts  (shared effective-monthly-rate helper)
 */
