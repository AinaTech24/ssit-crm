/**
 * Income Bridge Planner (SIP → SWP) — math engine.
 *
 * A two-phase retirement reckoner: ACCUMULATE a corpus with a (stepped-up) SIP
 * and/or lumpsum until retirement, then DRAW it down with a Systematic
 * Withdrawal Plan whose monthly payout rises with inflation — leaving a chosen
 * end balance behind.
 *
 * It answers two questions (calcType):
 *   • "monthly_swp"      — given my plan + the balance I want to leave, how much
 *                          monthly income (SWP) can I draw?
 *   • "investment_need"  — given the monthly income I want, how big a corpus —
 *                          and therefore what SIP / lumpsum — do I need?
 *
 * CONVENTIONS — calibrated to reproduce the reference reckoner to the rupee:
 *   Accumulation : EFFECTIVE monthly rate m = (1+a)^(1/12)−1, BEGIN-mode SIP
 *                  (paid at month start), step-up applied at each year boundary,
 *                  then the corpus is held (no contributions) from the SIP-stop
 *                  age to the retirement age.
 *   Distribution : EFFECTIVE monthly rate, END-mode (corpus grows, THEN the
 *                  month's withdrawal is taken), withdrawal grows at the
 *                  effective MONTHLY inflation rate (1+π)^(1/12)−1.
 *
 *   Worked example (SIP 25,000 · top-up 5% · age 35→40 SIP, hold →50 · 12%;
 *   then SWP 50→90 · 7% return · 5% inflation · leave the corpus intact):
 *     corpus = ₹68,83,098 · max end balance = ₹10,30,70,663 · SWP = ₹19,154.
 *   Do NOT switch to a nominal rate or change the withdrawal timing without
 *   re-checking these figures.
 */

export type CalcType = "monthly_swp" | "investment_need";
export type InvestMode = "sip" | "lumpsum" | "lumpsum_sip" | "salary";
export type PlanningType = "retirement" | "invest_now_withdraw_later";

export type IncomeBridgeInput = {
  calcType: CalcType;
  investMode: InvestMode;
  planningType: PlanningType;

  // Ages (years)
  startAge: number;
  sipTillAge: number;
  retirementAge: number;
  swpTillAge: number;

  // Accumulation inputs
  monthlySip: number;
  topUpPct: number;
  lumpsum: number;
  // Salary mode
  monthlySalary: number;
  savingsPct: number;
  salaryGrowthPct: number;
  accumReturnPct: number;

  // Distribution inputs
  distReturnPct: number;
  distInflationPct: number;
  endBalance: number; // balance required at end of SWP period
  desiredMonthlySwp: number; // used only in "investment_need"
};

export type DistYearRow = {
  age: number;
  monthlyWithdrawalThatYear: number;
  withdrawnThisYear: number;
  endCorpus: number;
};

export type IncomeBridgeResult = {
  // periods
  sipYears: number;
  holdYears: number;
  accumYears: number;
  distYears: number;
  distMonths: number;

  // accumulation
  effectiveMonthlySip: number; // salary-derived or direct
  totalInvested: number;
  corpus: number; // accumulated at retirement (forward) OR required (reverse)
  wealthGain: number;

  // distribution
  monthlySwp: number; // first-month withdrawal used in the plan
  lastMonthlySwp: number;
  totalWithdrawn: number;
  maxEndBalance: number; // corpus grown with zero withdrawal
  endBalanceActual: number;

  // reverse-mode extras
  requiredCorpus?: number;
  requiredMonthlySip?: number;
  requiredLumpsum?: number;
  requiredSavingsPct?: number; // salary mode

  feasible: boolean;
  warning?: string;

  schedule: DistYearRow[];
};

/* ───────────────────────── rate helpers ───────────────────────── */

const effM = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * FV at retirement of a ₹1/month stepped-up SIP: paid begin-mode for `sipYears`,
 * then the accumulated value held (no contributions) for `holdYears`. Effective
 * monthly rate.
 */
function sipCorpusFactor(sipYears: number, holdYears: number, stepUpPct: number, ratePct: number): number {
  const m = effM(ratePct);
  const s = stepUpPct / 100;
  const nSip = Math.round(sipYears * 12);
  const nHold = Math.round(holdYears * 12);
  let fv = 0;
  for (let mo = 0; mo < nSip; mo++) {
    const y = Math.floor(mo / 12);
    // begin-mode: a ₹1 paid at the start of month `mo` compounds for (nSip−mo)
    // months to the SIP-stop date.
    fv += Math.pow(1 + s, y) * Math.pow(1 + m, nSip - mo);
  }
  return fv * Math.pow(1 + m, nHold);
}

/** Total ₹ contributed by a stepped-up SIP over `sipYears`. */
function sipInvested(monthly: number, stepUpPct: number, sipYears: number): number {
  const s = stepUpPct / 100;
  let total = 0;
  for (let y = 0; y < Math.round(sipYears); y++) total += monthly * Math.pow(1 + s, y) * 12;
  return total;
}

/**
 * Σ over the distribution months of the inflation-grown unit withdrawal's
 * contribution to the END balance (end-mode):
 *   W1 = Σ_{mo=0}^{n−1} (1+gM)^mo · (1+m)^(n−1−mo)
 * so that  endBalance = corpus·(1+m)^n − P·W1.
 */
function withdrawalFactor(distMonths: number, distReturnPct: number, distInflationPct: number): number {
  const m = effM(distReturnPct);
  const gM = Math.pow(1 + distInflationPct / 100, 1 / 12) - 1;
  let w = 0;
  for (let mo = 0; mo < distMonths; mo++) {
    w += Math.pow(1 + gM, mo) * Math.pow(1 + m, distMonths - 1 - mo);
  }
  return w;
}

/** Month-by-month distribution simulation, aggregated to a per-year schedule. */
function simulateDistribution(
  corpus: number,
  firstMonthly: number,
  startAge: number,
  distMonths: number,
  distReturnPct: number,
  distInflationPct: number
): { schedule: DistYearRow[]; totalWithdrawn: number; lastMonthly: number; endBalance: number } {
  const m = effM(distReturnPct);
  const gM = Math.pow(1 + distInflationPct / 100, 1 / 12) - 1;
  let bal = corpus;
  let totalWithdrawn = 0;
  let lastMonthly = 0;
  const schedule: DistYearRow[] = [];
  let yearWithdraw = 0;
  let yearStartMonthly = firstMonthly;

  for (let mo = 0; mo < distMonths; mo++) {
    bal = bal * (1 + m);
    const w = firstMonthly * Math.pow(1 + gM, mo);
    bal -= w;
    totalWithdrawn += w;
    lastMonthly = w;
    yearWithdraw += w;
    if (mo % 12 === 0) yearStartMonthly = w;
    if (mo % 12 === 11 || mo === distMonths - 1) {
      schedule.push({
        age: startAge + Math.floor(mo / 12) + 1,
        monthlyWithdrawalThatYear: yearStartMonthly,
        withdrawnThisYear: yearWithdraw,
        endCorpus: bal,
      });
      yearWithdraw = 0;
    }
  }
  return { schedule, totalWithdrawn, lastMonthly, endBalance: bal };
}

/* ───────────────────────── main compute ───────────────────────── */

export function computeIncomeBridge(input: IncomeBridgeInput): IncomeBridgeResult {
  const accumYears = Math.max(0, input.retirementAge - input.startAge);
  const sipYears = clamp(input.sipTillAge - input.startAge, 0, accumYears);
  const holdYears = Math.max(0, accumYears - sipYears);
  const distYears = Math.max(0, input.swpTillAge - input.retirementAge);
  const distMonths = Math.round(distYears * 12);

  const usesSip = input.investMode === "sip" || input.investMode === "lumpsum_sip" || input.investMode === "salary";
  const usesLump = input.investMode === "lumpsum" || input.investMode === "lumpsum_sip";

  const effectiveMonthlySip =
    input.investMode === "salary" ? (input.monthlySalary * input.savingsPct) / 100 : input.monthlySip;
  const effStep = input.investMode === "salary" ? input.salaryGrowthPct : input.topUpPct;

  const sipFactor = sipCorpusFactor(sipYears, holdYears, effStep, input.accumReturnPct);
  const lumpFactor = Math.pow(1 + effM(input.accumReturnPct), Math.round(accumYears * 12));

  const distGrowth = Math.pow(1 + effM(input.distReturnPct), distMonths);
  const W1 = withdrawalFactor(distMonths, input.distReturnPct, input.distInflationPct);

  let feasible = true;
  let warning: string | undefined;

  // Resolve the corpus (forward = computed from plan; reverse = required), and
  // the first-month withdrawal P that the plan runs on.
  let corpus: number;
  let totalInvested: number;
  let monthlySwp: number;
  let requiredCorpus: number | undefined;
  let requiredMonthlySip: number | undefined;
  let requiredLumpsum: number | undefined;
  let requiredSavingsPct: number | undefined;

  if (input.calcType === "monthly_swp") {
    // Forward: build corpus from the entered plan, then solve sustainable SWP.
    corpus = (usesSip ? effectiveMonthlySip * sipFactor : 0) + (usesLump ? input.lumpsum * lumpFactor : 0);
    totalInvested =
      (usesSip ? sipInvested(effectiveMonthlySip, effStep, sipYears) : 0) + (usesLump ? input.lumpsum : 0);
    monthlySwp = W1 > 0 ? (corpus * distGrowth - input.endBalance) / W1 : 0;
    if (monthlySwp < 0) {
      feasible = false;
      monthlySwp = 0;
      warning =
        "The balance you want to leave is larger than the corpus can grow to with no withdrawals. Lower the end balance to draw an income.";
    }
  } else {
    // Reverse: from the desired SWP + end balance, back out the required corpus,
    // then the SIP / lumpsum needed to build it.
    const P = Math.max(0, input.desiredMonthlySwp);
    requiredCorpus = (input.endBalance + P * W1) / distGrowth;
    corpus = requiredCorpus;
    monthlySwp = P;

    if (input.investMode === "lumpsum") {
      requiredLumpsum = lumpFactor > 0 ? requiredCorpus / lumpFactor : 0;
      totalInvested = requiredLumpsum;
    } else if (input.investMode === "lumpsum_sip") {
      const fromLump = input.lumpsum * lumpFactor;
      const remainder = Math.max(0, requiredCorpus - fromLump);
      requiredMonthlySip = sipFactor > 0 ? remainder / sipFactor : 0;
      requiredLumpsum = input.lumpsum;
      totalInvested = input.lumpsum + sipInvested(requiredMonthlySip, effStep, sipYears);
    } else {
      // sip or salary
      requiredMonthlySip = sipFactor > 0 ? requiredCorpus / sipFactor : 0;
      totalInvested = sipInvested(requiredMonthlySip, effStep, sipYears);
      if (input.investMode === "salary" && input.monthlySalary > 0) {
        requiredSavingsPct = (requiredMonthlySip / input.monthlySalary) * 100;
      }
    }
  }

  const maxEndBalance = corpus * distGrowth;
  const sim = simulateDistribution(
    corpus,
    monthlySwp,
    input.retirementAge,
    distMonths,
    input.distReturnPct,
    input.distInflationPct
  );

  return {
    sipYears,
    holdYears,
    accumYears,
    distYears,
    distMonths,
    effectiveMonthlySip,
    totalInvested,
    corpus,
    wealthGain: corpus - totalInvested,
    monthlySwp,
    lastMonthlySwp: sim.lastMonthly,
    totalWithdrawn: sim.totalWithdrawn,
    maxEndBalance,
    endBalanceActual: sim.endBalance,
    requiredCorpus,
    requiredMonthlySip,
    requiredLumpsum,
    requiredSavingsPct,
    feasible,
    warning,
    schedule: sim.schedule,
  };
}
