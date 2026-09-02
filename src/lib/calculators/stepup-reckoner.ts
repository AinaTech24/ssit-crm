/**
 * Step-Up SIP Reckoner — math engine.
 *
 * From one starting monthly SIP it projects the future corpus under THREE
 * growth paths, across several timeframes at once:
 *   • Regular SIP            — constant monthly amount
 *   • Percentage step-up     — amount raised by X% at the start of each year
 *   • Fixed-amount step-up   — amount raised by ₹Y at the start of each year
 *
 * Same convention as the SIP 360° engine: EFFECTIVE monthly rate
 * ((1+annual)^(1/12)−1), payments at month-START (annuity-due). Verified to the
 * rupee against the reference "SIP + Step-Up SIP Ready Reckoner" case study
 * (₹10k/30y/12%: Regular ≈ ₹3.08cr, +10%/yr ≈ ₹7.98cr, +₹2,000/yr ≈ ₹7.57cr).
 */

import {
  monthlyRate, fvSip, fvStepUpSip, stepUpInvested,
} from "./sip360";

export { monthlyRate, fvSip, fvStepUpSip, stepUpInvested };

/** Total invested under a fixed-₹ annual step-up. */
export function stepUpAmountInvested(monthly: number, stepAmount: number, years: number): number {
  if (monthly <= 0 || years <= 0) return 0;
  let total = 0;
  for (let y = 0; y < years; y++) total += (monthly + stepAmount * y) * 12;
  return total;
}

/**
 * FV of a fixed-₹ step-up SIP — month-granular, annuity-due, effective monthly
 * rate. The monthly amount in year y (0-indexed) is monthly + stepAmount × y.
 */
export function fvStepUpAmountSip(
  monthly: number,
  stepAmount: number,
  annualPct: number,
  years: number
): number {
  if (monthly <= 0 || years <= 0) return 0;
  const m = monthlyRate(annualPct);
  const totalMonths = years * 12;
  let fv = 0;
  for (let mo = 0; mo < totalMonths; mo++) {
    const y = Math.floor(mo / 12);
    const pay = monthly + stepAmount * y;
    fv += pay * (m === 0 ? 1 : Math.pow(1 + m, totalMonths - mo));
  }
  return fv;
}

/* ───────────────────────── Aggregate ───────────────────────── */

export type ReckonerInput = {
  monthly: number;
  ratePct: number;
  /** Timeframes (years) to compare side by side. */
  periods: number[];
  /** Annual % step-up; 0 disables the percentage column. */
  stepUpPct: number;
  /** Annual ₹ step-up; 0 disables the fixed-amount column. */
  stepUpAmount: number;
};

export type StrategyCell = { invested: number; corpus: number; gain: number };

export type ReckonerRow = {
  years: number;
  regular: StrategyCell;
  stepPct: StrategyCell | null;
  stepAmt: StrategyCell | null;
};

export type ReckonerResult = {
  hasStepPct: boolean;
  hasStepAmt: boolean;
  rows: ReckonerRow[];
};

function cell(invested: number, corpus: number): StrategyCell {
  return { invested, corpus, gain: Math.max(0, corpus - invested) };
}

export function computeReckoner(input: ReckonerInput): ReckonerResult {
  const { monthly, ratePct } = input;
  const hasStepPct = (input.stepUpPct ?? 0) > 0;
  const hasStepAmt = (input.stepUpAmount ?? 0) > 0;

  const periods = (input.periods ?? [])
    .map((p) => Math.round(p))
    .filter((p) => p > 0)
    .filter((p, i, arr) => arr.indexOf(p) === i) // dedupe
    .sort((a, b) => a - b);

  const rows: ReckonerRow[] = periods.map((years) => {
    const months = years * 12;
    return {
      years,
      regular: cell(monthly * months, fvSip(monthly, ratePct, months)),
      stepPct: hasStepPct
        ? cell(stepUpInvested(monthly, input.stepUpPct, years), fvStepUpSip(monthly, input.stepUpPct, ratePct, years))
        : null,
      stepAmt: hasStepAmt
        ? cell(stepUpAmountInvested(monthly, input.stepUpAmount, years), fvStepUpAmountSip(monthly, input.stepUpAmount, ratePct, years))
        : null,
    };
  });

  return { hasStepPct, hasStepAmt, rows };
}
