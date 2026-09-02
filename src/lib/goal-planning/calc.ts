/**
 * Goal-planning math — pure formulas, no DB / no React.
 *
 * Conventions:
 *   r        annual return rate, decimal (e.g. 0.12 for 12 % p.a.)
 *   m        monthly rate, r/12
 *   n        number of months
 *   π        annual inflation, decimal (e.g. 0.06 for 6 % p.a.)
 *
 * Compounding: monthly. SIPs paid at month-START — annuity-due / "Begin Mode"
 * (note the trailing × (1 + m) in FV_sip below). This matches the calculators'
 * on-screen disclaimer; do NOT drop the (1 + m) factor thinking it's an
 * ordinary (month-end) annuity. The 0% case is the linear limit (Σ payments).
 *
 * Formulas
 *   Inflation-adjusted (future) target:
 *     T_future = T_today × (1 + π)^years
 *
 *   FV of an existing lumpsum:
 *     FV_lump = PV × (1 + m)^n
 *
 *   FV of a constant monthly SIP (annuity-due):
 *     FV_sip = P × ((1 + m)^n − 1) / m × (1 + m)
 *
 *   Constant SIP needed to reach Target (with no PV):
 *     P_req = Target × m / (((1 + m)^n − 1) × (1 + m))
 *
 *   Lumpsum needed today to reach Target (with no SIP):
 *     L_req = Target / (1 + m)^n
 *
 *   Step-up SIP — initial monthly P0 increased by g % each year. We solve for P0
 *   numerically (closed form is awkward with annual step-ups).
 */

export const DEFAULT_EXPECTED_RETURN_PCT = 12;
export const DEFAULT_INFLATION_PCT = 6;
export const DEFAULT_STEP_UP_PCT = 0;

/* ───────────────────────── Core formulas ───────────────────────── */

export function inflatedTarget(presentTarget: number, inflationPct: number, years: number): number {
  return presentTarget * Math.pow(1 + inflationPct / 100, years);
}

export function fvLumpsum(pv: number, annualReturnPct: number, months: number): number {
  const m = annualReturnPct / 100 / 12;
  return pv * Math.pow(1 + m, months);
}

export function fvSip(monthlySip: number, annualReturnPct: number, months: number): number {
  if (monthlySip <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  // 0% return ⇒ the (… )/m term is 0/0. The flat-return limit is just the sum
  // of the contributions (no growth). Without this guard the calculators
  // return NaN whenever an RM demos a flat/conservative scenario.
  if (m === 0) return monthlySip * months;
  return monthlySip * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
}

/* ───────────────── Growing SIP (BIRD calculator) ─────────────────
 * Faithful replica of the "Growing SIP & SIP" workbook. Two differences from
 * the helpers above, kept intentionally so the numbers MATCH that sheet:
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

/* ───────────────── Advanced Vacation Planner (EFP calculator) ─────────────────
 * Faithful replica of the "Advanced Vacation Calculator" workbook. The client
 * wants to fund a stream of `numVacations` annual vacations — the first a year
 * out — each escalating with inflation, drawn from a corpus that earns the
 * equity return. The corpus needed is a growing annuity-DUE present value; the
 * gap left after growing the initial investment one year is funded by a
 * growing SIP (annual or monthly variant).
 *
 * `excelPV` replicates Excel's PV(rate, nper, pmt, fv, type) exactly. NOTE: the
 * workbook's ANNUAL path hard-codes a stale ₹10 L "initial after a year" (its
 * input grew to ₹20 L); we instead grow the ACTUAL initial investment by one
 * year for BOTH the annual and monthly SIP — which is what the sheet's monthly
 * path already does — so the two are internally consistent. The monthly figure
 * reproduces the workbook to the rupee; the annual one is the consistent value.
 */
function excelPV(rate: number, nper: number, pmt: number, fv = 0, type = 0): number {
  if (nper <= 0) return 0;
  if (rate === 0) return -(pmt * nper + fv);
  const p = Math.pow(1 + rate, -nper);
  return -(pmt * (1 + rate * type) * ((1 - p) / rate) + fv * p);
}

export type VacationDrawdownRow = {
  index: number; // 1-based vacation number
  cost: number; // escalated cost of this vacation
  balanceAfter: number; // corpus balance after the withdrawal + a year of growth
};

export type VacationPlanInput = {
  initialInvestment: number;
  equityReturnPct: number;
  sipGrowthPct: number;
  sipYears: number;
  currentVacationCost: number;
  vacationInflationPct: number;
  numVacations: number;
};

export type VacationPlanResult = {
  realRatePct: number; // (1+r)/(1+infl)−1, ×100 — the growth-adjusted discount rate
  corpusNeeded: number; // growing annuity-due PV of the escalating vacation stream
  initialAfterOneYear: number; // initial × (1+r)
  amountStillNeeded: number; // max(0, corpus − grown initial)
  annualSip: number; // first-year growing annual SIP
  monthlySip: number; // first-month growing monthly SIP
  totalNominalSpend: number; // sum of all escalated vacation costs
  drawdown: VacationDrawdownRow[];
};

export function vacationPlan(input: VacationPlanInput): VacationPlanResult {
  const r = input.equityReturnPct / 100;
  const g = input.sipGrowthPct / 100;
  const infl = input.vacationInflationPct / 100;
  const n = Math.max(0, Math.floor(input.numVacations));
  const cost0 = Math.max(0, input.currentVacationCost);
  const sipYears = Math.max(0, Math.floor(input.sipYears));

  // Step 2 — corpus: growing annuity-due PV of the escalating vacation stream.
  const realRate = (1 + r) / (1 + infl) - 1;
  const corpusNeeded = excelPV(realRate, n, -cost0, 0, 1);

  // Step 1 — initial investment grown by one year.
  const initialAfterOneYear = Math.max(0, input.initialInvestment) * (1 + r);

  // Step 3 — gap to fund from the growing SIP.
  const amountStillNeeded = Math.max(0, corpusNeeded - initialAfterOneYear);

  // Steps 7–10 — required growing SIP = gap ÷ PV(₹100 growing SIP) × 100.
  const pv100Annual = excelPV((1 + r) / (1 + g) - 1, sipYears, -100, 0, 1);
  const pv100Monthly = excelPV(Math.pow((1 + r) / (1 + g), 1 / 12) - 1, sipYears * 12, -100, 0, 1);
  const annualSip = pv100Annual > 0 ? (amountStillNeeded / pv100Annual) * 100 : 0;
  const monthlySip = pv100Monthly > 0 ? (amountStillNeeded / pv100Monthly) * 100 : 0;

  // Drawdown trajectory — validates the corpus (it depletes to ≈0 after n vacations).
  const drawdown: VacationDrawdownRow[] = [];
  let bal = corpusNeeded;
  let totalNominalSpend = 0;
  for (let k = 0; k < n; k++) {
    const cost = cost0 * Math.pow(1 + infl, k);
    totalNominalSpend += cost;
    bal = (bal - cost) * (1 + r); // annuity-due: withdraw at start, grow the remainder
    drawdown.push({ index: k + 1, cost, balanceAfter: bal });
  }

  return {
    realRatePct: realRate * 100,
    corpusNeeded,
    initialAfterOneYear,
    amountStillNeeded,
    annualSip,
    monthlySip,
    totalNominalSpend,
    drawdown,
  };
}

/* ──────────── Unconventional SWP — OPM to buy a house (Financial Pathshala) ────────────
 * Leverage strategy: instead of paying cash for the house, take the loan AND
 * invest the same amount in an equity MF, then run an SWP that withdraws each
 * EMI. While the MF return exceeds the loan rate the corpus outlives the loan,
 * so once the loan is cleared a corpus still remains — the house effectively
 * funded by "other people's money". Faithful replica of the workbook (to ₹).
 *
 * Loan side (amortising): interestₘ = balₘ₋₁·r;  balₘ = balₘ₋₁ − (EMI − interestₘ).
 * MF side (SWP at the START of the month, then a month's growth):
 *   Lₘ = Oₘ₋₁ (L₁ = invested);  Nₘ = Lₘ − EMI;  Oₘ = Nₘ·(1 + mfr).
 */
export type OpmYearRow = {
  year: number;
  loanBalance: number;
  mfCorpus: number;
  cumInterest: number;
  cumWithdrawal: number;
};

export type OpmResult = {
  emi: number;
  months: number;
  totalPaid: number; // Σ EMI = total SWP withdrawal
  totalInterest: number; // Σ interest
  corpusLeft: number; // MF corpus after the final month
  minCorpus: number; // lowest post-SWP balance (flags depletion)
  corpusSurvived: boolean; // corpus never went negative ⇒ strategy holds
  loanBalanceEnd: number; // ≈ 0 when fully amortised
  yearly: OpmYearRow[];
};

export function opmHouseStrategy(input: {
  loanAmount: number; // also the amount invested in the MF
  loanRatePct: number;
  tenureYears: number;
  mfReturnPct: number;
}): OpmResult {
  const months = Math.max(0, Math.round(input.tenureYears * 12));
  const loan = Math.max(0, input.loanAmount);
  const r = input.loanRatePct / 100 / 12;
  const mfr = input.mfReturnPct / 100 / 12;
  // EMI = Excel PMT(r, months, -loan): flat-rate limit guarded.
  const emi = months === 0 ? 0 : r === 0 ? loan / months : (loan * r) / (1 - Math.pow(1 + r, -months));

  let loanBal = loan;
  let cumInterest = 0;
  let cumWithdrawal = 0;
  let mfO = loan; // corpus "balance amount" carried into the next month
  let minCorpus = loan;
  let corpusSurvived = true;

  const yearly: OpmYearRow[] = [];
  for (let m = 1; m <= months; m++) {
    // Loan amortisation.
    const interest = loanBal * r;
    loanBal = loanBal - (emi - interest);
    cumInterest += interest;

    // MF + SWP — withdraw EMI at the start, grow the remainder one month.
    const L = m === 1 ? loan : mfO;
    const afterSwp = L - emi;
    if (afterSwp < minCorpus) minCorpus = afterSwp;
    if (afterSwp < 0) corpusSurvived = false;
    mfO = afterSwp + afterSwp * mfr;
    cumWithdrawal += emi;

    if (m % 12 === 0 || m === months) {
      yearly.push({
        year: Math.ceil(m / 12),
        loanBalance: Math.max(0, loanBal),
        mfCorpus: mfO,
        cumInterest,
        cumWithdrawal,
      });
    }
  }

  return {
    emi,
    months,
    totalPaid: cumWithdrawal,
    totalInterest: cumInterest,
    corpusLeft: months === 0 ? loan : mfO,
    minCorpus,
    corpusSurvived,
    loanBalanceEnd: months === 0 ? loan : loanBal,
    yearly,
  };
}

/** Constant monthly SIP needed to hit `target` starting from `currentValue`. */
export function requiredSip(
  target: number,
  currentValue: number,
  annualReturnPct: number,
  months: number
): number {
  if (months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const shortfall = Math.max(0, target - lumpFV);
  if (shortfall === 0) return 0;
  // 0% return ⇒ flat-return limit: the SIP simply sums to the shortfall.
  if (m === 0) return shortfall / months;
  return (shortfall * m) / ((Math.pow(1 + m, months) - 1) * (1 + m));
}

/** Lumpsum needed today to hit `target` with no SIP. */
export function requiredLumpsumToday(
  target: number,
  annualReturnPct: number,
  months: number
): number {
  if (months <= 0) return target;
  return target / Math.pow(1 + annualReturnPct / 100 / 12, months);
}

/**
 * FV of a step-up SIP: P0 increases by stepUpPct every 12 months.
 */
export function fvStepUpSip(
  initialMonthly: number,
  annualReturnPct: number,
  months: number,
  stepUpPct: number
): number {
  if (initialMonthly <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const s = stepUpPct / 100;
  const fullYears = Math.floor(months / 12);
  const remainderMonths = months - fullYears * 12;

  // 0% return ⇒ flat-return limit: total value is just the sum of every
  // (stepped-up) contribution, no growth. Guards the 0/0 in fv1yr below.
  if (m === 0) {
    let flat = 0;
    for (let k = 0; k < fullYears; k++) flat += initialMonthly * Math.pow(1 + s, k) * 12;
    if (remainderMonths > 0) flat += initialMonthly * Math.pow(1 + s, fullYears) * remainderMonths;
    return flat;
  }

  const fv1yr = ((Math.pow(1 + m, 12) - 1) / m) * (1 + m);

  let fv = 0;
  for (let k = 0; k < fullYears; k++) {
    const yearP = initialMonthly * Math.pow(1 + s, k);
    const yearsToCompound = fullYears - 1 - k;
    const growth = Math.pow(1 + m, yearsToCompound * 12 + remainderMonths);
    fv += yearP * fv1yr * growth;
  }
  if (remainderMonths > 0) {
    const finalP = initialMonthly * Math.pow(1 + s, fullYears);
    fv += fvSip(finalP, annualReturnPct, remainderMonths);
  }
  return fv;
}

/**
 * Initial monthly SIP (P0) for a step-up plan that reaches `target` given PV.
 * Solved by bisection.
 */
export function requiredStepUpSip(
  target: number,
  currentValue: number,
  annualReturnPct: number,
  months: number,
  stepUpPct: number
): number {
  if (months <= 0) return 0;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const need = Math.max(0, target - lumpFV);
  if (need === 0) return 0;
  const flatEst = requiredSip(target, currentValue, annualReturnPct, months);
  let lo = 0;
  let hi = Math.max(flatEst * 2, 100);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fv = fvStepUpSip(mid, annualReturnPct, months, stepUpPct);
    if (fv >= need) hi = mid;
    else lo = mid;
    if (hi - lo < 0.5) break;
  }
  return (lo + hi) / 2;
}

/* ───────────────────────── Months helper ───────────────────────── */

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/* ──────────── Network FP 3.5 calculators (5) (6) (8) ──────────── */

/**
 * Cost of Delay — same SIP, two start ages. How much wealth lost by
 * starting later?
 *
 * lumpsum is optional one-shot at the start; sipAmount runs monthly
 * from startAge to endAge.
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

/* ───────────────────────── Year-by-year projection ───────────────────────── */

export type ProjectionRow = {
  year: number;
  monthlySip: number;
  contributedThisYear: number;
  cumulativeContributed: number;
  endOfYearCorpus: number;
};

export function projectYearly(input: {
  currentValue: number;
  initialMonthlySip: number;
  annualReturnPct: number;
  stepUpPct?: number;
  months: number;
}): ProjectionRow[] {
  const m = input.annualReturnPct / 100 / 12;
  const s = (input.stepUpPct ?? 0) / 100;
  const years = Math.ceil(input.months / 12);
  let corpus = input.currentValue;
  let monthlySip = input.initialMonthlySip;
  let cumulative = 0;
  const rows: ProjectionRow[] = [];

  for (let y = 1; y <= years; y++) {
    const monthsThisYear = y === years ? input.months - (years - 1) * 12 : 12;
    if (monthsThisYear <= 0) break;
    let yearContrib = 0;
    for (let mo = 0; mo < monthsThisYear; mo++) {
      corpus = corpus * (1 + m) + monthlySip;
      yearContrib += monthlySip;
    }
    cumulative += yearContrib;
    rows.push({
      year: y,
      monthlySip,
      contributedThisYear: yearContrib,
      cumulativeContributed: cumulative,
      endOfYearCorpus: corpus,
    });
    monthlySip = monthlySip * (1 + s);
  }
  return rows;
}

/* ───────────────────────── Sensitivity ───────────────────────── */

export function sensitivitySipRates(
  target: number,
  currentValue: number,
  months: number,
  rates: number[] = [8, 10, 12, 15]
): Array<{ ratePct: number; sip: number; lumpsum: number; projectedFV: number }> {
  return rates.map((rate) => ({
    ratePct: rate,
    sip: requiredSip(target, currentValue, rate, months),
    lumpsum: requiredLumpsumToday(target, rate, months),
    projectedFV: fvLumpsum(currentValue, rate, months),
  }));
}

/* ───────────────────────── Combined "compute goal" ───────────────────────── */

export type GoalCalcInput = {
  /** Target amount in TODAY's money (will be inflation-adjusted). */
  presentTarget?: number;
  /** Target amount already in FUTURE money (skips inflation). */
  futureTarget?: number;
  currentValue: number;
  existingMonthlySip: number;
  monthsLeft: number;
  expectedReturnPct?: number;
  inflationPct?: number;
  stepUpPct?: number;
};

export type GoalCalcResult = {
  monthsLeft: number;
  yearsLeft: number;
  expectedReturnPct: number;
  inflationPct: number;
  stepUpPct: number;
  presentTarget: number;
  futureTarget: number;
  projectedLumpsumFV: number;
  projectedSipFV: number;
  projectedTotalFV: number;
  gapAmount: number;
  requiredMonthlySipTotal: number;
  requiredStepUpInitialSip: number;
  requiredLumpsumToday: number;
  additionalMonthlySipNeeded: number;
  /** Same key the DB enum uses */
  status: "not_started" | "on_track" | "behind_track" | "achieved";
};

/** Backwards-compatible single-call API used everywhere in the app. */
export function computeGoal(input: GoalCalcInput & { targetAmount?: number }): GoalCalcResult {
  // The legacy callers passed `targetAmount` (already in target-date money).
  // Map it to futureTarget so we don't double-inflate.
  const futureTarget =
    input.futureTarget ?? input.targetAmount ?? null;
  const presentTarget =
    input.presentTarget ?? (futureTarget == null ? 0 : undefined);

  const months = Math.max(0, Math.round(input.monthsLeft));
  const years = Math.max(0, months / 12);
  const expectedReturnPct = input.expectedReturnPct ?? DEFAULT_EXPECTED_RETURN_PCT;
  const inflationPct = input.inflationPct ?? DEFAULT_INFLATION_PCT;
  const stepUpPct = input.stepUpPct ?? DEFAULT_STEP_UP_PCT;

  const pT = presentTarget ?? input.presentTarget ?? 0;
  const fT =
    futureTarget != null
      ? futureTarget
      : inflatedTarget(pT, inflationPct, years);

  const pv = Math.max(0, input.currentValue);
  const sip = Math.max(0, input.existingMonthlySip);

  if (months === 0) {
    const gap = Math.max(0, fT - pv);
    return {
      monthsLeft: 0,
      yearsLeft: 0,
      expectedReturnPct,
      inflationPct,
      stepUpPct,
      presentTarget: pT,
      futureTarget: fT,
      projectedLumpsumFV: pv,
      projectedSipFV: 0,
      projectedTotalFV: pv,
      gapAmount: gap,
      requiredMonthlySipTotal: 0,
      requiredStepUpInitialSip: 0,
      requiredLumpsumToday: fT,
      additionalMonthlySipNeeded: 0,
      status: pv >= fT ? "achieved" : "behind_track",
    };
  }

  const projectedLumpsumFV = fvLumpsum(pv, expectedReturnPct, months);
  const projectedSipFV = fvSip(sip, expectedReturnPct, months);
  const projectedTotalFV = projectedLumpsumFV + projectedSipFV;

  const requiredMonthlySipTotal = requiredSip(fT, pv, expectedReturnPct, months);
  const requiredStepUpInitialSip =
    stepUpPct > 0
      ? requiredStepUpSip(fT, pv, expectedReturnPct, months, stepUpPct)
      : requiredMonthlySipTotal;
  const requiredLumpsumNow = requiredLumpsumToday(fT, expectedReturnPct, months);

  const additionalMonthlySipNeeded = Math.max(0, requiredMonthlySipTotal - sip);
  const gapAmount = Math.max(0, fT - projectedTotalFV);

  let status: GoalCalcResult["status"];
  if (pv === 0 && sip === 0) status = "not_started";
  else if (projectedTotalFV >= fT) status = "achieved";
  else status = sip >= requiredMonthlySipTotal * 0.9 ? "on_track" : "behind_track";

  return {
    monthsLeft: months,
    yearsLeft: years,
    expectedReturnPct,
    inflationPct,
    stepUpPct,
    presentTarget: pT,
    futureTarget: fT,
    projectedLumpsumFV,
    projectedSipFV,
    projectedTotalFV,
    gapAmount,
    requiredMonthlySipTotal,
    requiredStepUpInitialSip,
    requiredLumpsumToday: requiredLumpsumNow,
    additionalMonthlySipNeeded,
    status,
  };
}

/* ───────────────────────── Categories (display) ───────────────────────── */

export const GOAL_CATEGORIES = [
  ["retirement", "Retirement"],
  ["child_education", "Child Education"],
  ["child_marriage", "Child Marriage"],
  ["house", "House"],
  ["car", "Car"],
  ["vacation", "Vacation"],
  ["emergency_fund", "Emergency Fund"],
  ["wealth_creation", "Wealth Creation"],
  ["other", "Other"],
] as const;

export const CATEGORY_ALIASES: Record<string, string> = {
  education: "child_education",
  vehicle: "car",
  emergency: "emergency_fund",
  wedding: "child_marriage",
  wealth: "wealth_creation",
};

export function categoryLabel(slug: string): string {
  const canon = CATEGORY_ALIASES[slug] ?? slug;
  return GOAL_CATEGORIES.find(([k]) => k === canon)?.[1] ?? slug;
}

/* ───────────────────────── STP & CAGR Calculators ───────────────────────── */

export interface StpResult {
  invested: number;
  sourceFinalValue: number;
  targetFinalValue: number;
  totalFinalValue: number;
  gain: number;
}

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
