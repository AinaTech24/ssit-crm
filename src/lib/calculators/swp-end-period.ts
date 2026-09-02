/**
 * SWP End Period — math engine.
 *
 * Estimates how long a corpus lasts under a Systematic Withdrawal Plan. The
 * corpus is built either from a lumpsum (optionally deferred/grown) or an
 * SIP accumulated over a deferment period, then drawn down monthly — at a
 * fixed amount or a % of the starting corpus — optionally rising with
 * inflation each year.
 *
 * Convention: effective monthly rate ((1+annual)^(1/12)−1). Accumulation SIPs
 * are begin-mode (annuity-due); SWP withdrawals are begin-mode (withdraw at
 * month start, remaining balance then grows) — consistent with the rest of the
 * suite. Reference case (SIP ₹25k/mo × 20y @12% → ₹2.30cr; SWP ₹2L/mo @9%)
 * lasts ~20 years.
 */

import { monthlyRate, fvSip, fvLumpsum } from "./sip360";

export type InvestmentType = "lumpsum" | "sip";
export type SwpMode = "amount" | "percentage";

export type SwpEndInput = {
  investmentType: InvestmentType;
  initialInvestment: number; // lumpsum amount OR monthly SIP amount
  defermentRequired: boolean;
  defermentYears: number; // SIP duration, or lumpsum grow-before-SWP period
  accumulationRatePct: number; // return during SIP / deferment
  swpRatePct: number; // return during SWP
  includeInflation: boolean;
  inflationPct: number;
  swpMode: SwpMode;
  swpAmount: number; // mode = amount
  swpPercentage: number; // mode = percentage (annual % of starting corpus)
};

export type SwpYearRow = { year: number; monthlyWithdrawal: number; withdrawnThisYear: number; endBalance: number };

export type SwpEndResult = {
  accumulatedValue: number;
  baseMonthlyWithdrawal: number;
  /** Full months the corpus sustained withdrawals; null = beyond the cap. */
  monthsLasted: number | null;
  perpetual: boolean;
  totalWithdrawn: number;
  yearRows: SwpYearRow[];
  capYears: number;
};

const CAP_YEARS = 100;

export function computeSwpEndPeriod(input: SwpEndInput): SwpEndResult {
  // ── Phase 1: accumulate the corpus ──
  let accumulatedValue: number;
  const defMonths = Math.max(0, Math.round(input.defermentYears * 12));
  if (input.investmentType === "sip") {
    accumulatedValue = fvSip(input.initialInvestment, input.accumulationRatePct, defMonths);
  } else {
    accumulatedValue = input.defermentRequired
      ? fvLumpsum(input.initialInvestment, input.accumulationRatePct, defMonths)
      : input.initialInvestment;
  }

  // ── Base monthly withdrawal ──
  const baseMonthly =
    input.swpMode === "percentage"
      ? (accumulatedValue * (input.swpPercentage / 100)) / 12
      : input.swpAmount;

  // ── Phase 2: simulate the drawdown ──
  const m = monthlyRate(input.swpRatePct);
  const capMonths = CAP_YEARS * 12;
  let bal = accumulatedValue;
  let withdrawn = 0;
  let monthsLasted: number | null = null;
  let curMonthly = baseMonthly;
  const yearRows: SwpYearRow[] = [];
  let withdrawnThisYear = 0;

  if (baseMonthly <= 0 || accumulatedValue <= 0) {
    return {
      accumulatedValue,
      baseMonthlyWithdrawal: baseMonthly,
      monthsLasted: 0,
      perpetual: false,
      totalWithdrawn: 0,
      yearRows: [],
      capYears: CAP_YEARS,
    };
  }

  for (let i = 0; i < capMonths; i++) {
    // Step the withdrawal up by inflation at each year boundary.
    if (i > 0 && i % 12 === 0 && input.includeInflation) {
      curMonthly *= 1 + input.inflationPct / 100;
    }
    if (bal < curMonthly) {
      // Partial final withdrawal — corpus exhausted this month.
      withdrawn += bal;
      withdrawnThisYear += bal;
      bal = 0;
      monthsLasted = i;
      yearRows.push({
        year: Math.ceil((i + 1) / 12),
        monthlyWithdrawal: curMonthly,
        withdrawnThisYear,
        endBalance: 0,
      });
      break;
    }
    bal -= curMonthly;
    withdrawn += curMonthly;
    withdrawnThisYear += curMonthly;
    bal *= 1 + m;
    if ((i + 1) % 12 === 0) {
      yearRows.push({
        year: (i + 1) / 12,
        monthlyWithdrawal: curMonthly,
        withdrawnThisYear,
        endBalance: bal,
      });
      withdrawnThisYear = 0;
    }
  }

  const perpetual = monthsLasted === null;

  return {
    accumulatedValue,
    baseMonthlyWithdrawal: baseMonthly,
    monthsLasted,
    perpetual,
    totalWithdrawn: withdrawn,
    yearRows,
    capYears: CAP_YEARS,
  };
}
