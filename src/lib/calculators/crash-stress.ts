/**
 * Market-Crash Stress Test — math engine.
 *
 * Simulates an SIP (+ optional lumpsum) through a market crash of −X% at a
 * chosen year, and contrasts three behaviours:
 *   • Stay invested   — keep SI-ing through the crash and recovery
 *   • No crash        — the smooth baseline (for reference)
 *   • Panic sell      — redeem at the crash bottom, park in cash/FD, keep saving there
 *
 * Reports the final corpus for each path, the recovery time, and the "cost of
 * panic". Convention: effective monthly rate, SIP at month start (begin mode);
 * the crash is a one-time shock applied at the end of the crash year's month.
 */

import { monthlyRate } from "./sip360";

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
