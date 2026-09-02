/**
 * SWP Comprehensive — math engine.
 *
 * The full SWP planner: build a corpus via one of four investment modes
 * (lumpsum / annual lumpsum / SIP / lumpsum+SIP) with an accumulation phase and
 * optional deferment, then draw it down in the distribution phase at a chosen
 * frequency (monthly / quarterly / half-yearly / annually), as a fixed amount
 * or a % of corpus, optionally rising each year. Reports the per-period
 * withdrawal, the maximum sustainable withdrawal, and the final corpus value.
 *
 * Convention: effective per-period rate from the annual return; withdrawals at
 * period END ("starting next period"). Reference case (₹50L lumpsum @9%,
 * withdraw 7%/yr monthly for 15y) → ₹29,167/mo, final value ≈ ₹75.19L; max
 * sustainable ≈ ₹49,674/mo (~11.9%/yr).
 */

import { monthlyRate, fvSip } from "./sip360";

export type InvestMode = "lumpsum" | "annual_lumpsum" | "sip" | "lumpsum_sip";
export type Frequency = "monthly" | "quarterly" | "halfyearly" | "annually";
export type WithdrawalMode = "amount" | "percentage";
export type IncrementMode = "none" | "percentage" | "amount";

export type Allocation = { debtPct: number; hybridPct: number; equityPct: number };
export type Rates = { debtPct: number; hybridPct: number; equityPct: number };

export const FREQ_PER_YEAR: Record<Frequency, number> = {
  monthly: 12, quarterly: 4, halfyearly: 2, annually: 1,
};

export const FREQ_LABEL: Record<Frequency, string> = {
  monthly: "month", quarterly: "quarter", halfyearly: "half-year", annually: "year",
};

/** Allocation-weighted average return. Returns 0 when nothing is allocated. */
export function weightedAvg(alloc: Allocation, rates: Rates): number {
  const total = alloc.debtPct + alloc.hybridPct + alloc.equityPct;
  if (total <= 0) return 0;
  return (alloc.debtPct * rates.debtPct + alloc.hybridPct * rates.hybridPct + alloc.equityPct * rates.equityPct) / total;
}

/** Effective per-period rate for a given annual % and periods/year. */
export function periodRate(annualPct: number, perYear: number): number {
  return Math.pow(1 + annualPct / 100, 1 / perYear) - 1;
}

export type SwpCompInput = {
  investMode: InvestMode;
  lumpsum: number; // lumpsum / annual-lumpsum amount
  monthlySip: number; // SIP amount (sip / lumpsum_sip)
  accumulationYears: number; // annual_lumpsum / sip / lumpsum_sip
  accumulationReturnPct: number;
  defermentYears: number;
  distReturnPct: number; // weighted avg of distribution allocation
  swpYears: number;
  frequency: Frequency;
  withdrawalMode: WithdrawalMode;
  withdrawalAmount: number; // per-period amount (amount mode)
  withdrawalAnnualPct: number; // total annual % of corpus (percentage mode)
  increment: IncrementMode;
  incrementPct: number;
  incrementAmount: number;
};

export type SwpCompYearRow = { year: number; withdrawalPerPeriod: number; withdrawnThisYear: number; endBalance: number };

export type SwpCompResult = {
  accumulatedCorpus: number;
  perYear: number;
  basePerPeriodWithdrawal: number;
  maxPerPeriodWithdrawal: number;
  maxAnnualPct: number;
  exceedsMax: boolean;
  finalValue: number;
  totalWithdrawn: number;
  depletedAtPeriod: number | null;
  yearRows: SwpCompYearRow[];
};

/** Corpus at the start of the distribution phase. */
export function accumulate(input: SwpCompInput): number {
  const accR = input.accumulationReturnPct;
  const accYears = Math.max(0, Math.round(input.accumulationYears));
  let corpus = 0;

  switch (input.investMode) {
    case "lumpsum":
      corpus = input.lumpsum;
      break;
    case "annual_lumpsum": {
      // One lumpsum invested at the start of each year (annuity-due, annual).
      const r = accR / 100;
      for (let t = 0; t < accYears; t++) corpus += input.lumpsum * Math.pow(1 + r, accYears - t);
      break;
    }
    case "sip":
      corpus = fvSip(input.monthlySip, accR, accYears * 12);
      break;
    case "lumpsum_sip": {
      const r = accR / 100;
      corpus = input.lumpsum * Math.pow(1 + r, accYears) + fvSip(input.monthlySip, accR, accYears * 12);
      break;
    }
  }

  // Deferment: the corpus sits in the distribution portfolio, growing untouched.
  const defMonths = Math.max(0, Math.round(input.defermentYears * 12));
  if (defMonths > 0) corpus *= Math.pow(1 + monthlyRate(input.distReturnPct), defMonths);

  return corpus;
}

export function computeSwpComprehensive(input: SwpCompInput): SwpCompResult {
  const corpus = accumulate(input);
  const perYear = FREQ_PER_YEAR[input.frequency];
  const pr = periodRate(input.distReturnPct, perYear);
  const nPeriods = Math.max(0, Math.round(input.swpYears * perYear));

  // Base per-period withdrawal.
  const basePerPeriod =
    input.withdrawalMode === "percentage"
      ? (corpus * (input.withdrawalAnnualPct / 100)) / perYear
      : input.withdrawalAmount;

  // Maximum sustainable level per-period withdrawal (deplete to 0 at nPeriods).
  const maxPerPeriod =
    nPeriods <= 0 ? 0 : pr === 0 ? corpus / nPeriods : (corpus * pr) / (1 - Math.pow(1 + pr, -nPeriods));
  const maxAnnualPct = corpus > 0 ? (maxPerPeriod * perYear) / corpus * 100 : 0;

  // Simulate the drawdown (grow then withdraw at period end).
  let bal = corpus;
  let withdrawn = 0;
  let depletedAtPeriod: number | null = null;
  let curWithdrawal = basePerPeriod;
  let withdrawnThisYear = 0;
  const yearRows: SwpCompYearRow[] = [];

  for (let i = 0; i < nPeriods; i++) {
    // Annual increment at each year boundary.
    if (i > 0 && i % perYear === 0 && input.increment !== "none") {
      if (input.increment === "percentage") curWithdrawal *= 1 + input.incrementPct / 100;
      else curWithdrawal += input.incrementAmount;
    }
    bal *= 1 + pr;
    if (bal < curWithdrawal) {
      withdrawn += bal;
      withdrawnThisYear += bal;
      bal = 0;
      depletedAtPeriod = i + 1;
    } else {
      bal -= curWithdrawal;
      withdrawn += curWithdrawal;
      withdrawnThisYear += curWithdrawal;
    }
    if ((i + 1) % perYear === 0 || i === nPeriods - 1) {
      yearRows.push({
        year: Math.ceil((i + 1) / perYear),
        withdrawalPerPeriod: curWithdrawal,
        withdrawnThisYear,
        endBalance: bal,
      });
      withdrawnThisYear = 0;
    }
    if (depletedAtPeriod !== null) break;
  }

  return {
    accumulatedCorpus: corpus,
    perYear,
    basePerPeriodWithdrawal: basePerPeriod,
    maxPerPeriodWithdrawal: maxPerPeriod,
    maxAnnualPct,
    exceedsMax: basePerPeriod > maxPerPeriod + 1e-6,
    finalValue: bal,
    totalWithdrawn: withdrawn,
    depletedAtPeriod,
    yearRows,
  };
}
