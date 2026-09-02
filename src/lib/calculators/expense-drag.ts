/**
 * Expense-Ratio Drag — math engine.
 *
 * Shows how much a higher expense ratio (e.g. regular vs direct plan, or fund A
 * vs B) silently costs over time, for a lumpsum and/or monthly SIP. Net return
 * = gross return − expense ratio; FV computed at the net return.
 *
 * Convention: effective monthly rate, SIP at month start (begin mode).
 */

import { monthlyRate } from "./sip360";

function fv(lumpsum: number, monthlySip: number, netReturnPct: number, years: number): number {
  const m = monthlyRate(netReturnPct);
  const n = Math.max(0, Math.round(years * 12));
  const lumpFV = lumpsum * Math.pow(1 + m, n);
  const sipFV = m === 0 ? monthlySip * n : monthlySip * ((Math.pow(1 + m, n) - 1) / m) * (1 + m);
  return lumpFV + sipFV;
}

export type ExpenseDragInput = {
  lumpsum: number;
  monthlySip: number;
  years: number;
  grossReturnPct: number;
  expenseRatioAPct: number; // e.g. regular plan 1.5
  expenseRatioBPct: number; // e.g. direct plan 0.5
};

export type ExpenseDragResult = {
  totalInvested: number;
  fvA: number;
  fvB: number;
  drag: number; // fvB − fvA (extra wealth from the lower-cost option)
  dragPctOfCorpus: number;
  netReturnA: number;
  netReturnB: number;
  series: { year: number; a: number; b: number }[];
};

export function computeExpenseDrag(input: ExpenseDragInput): ExpenseDragResult {
  const netA = input.grossReturnPct - input.expenseRatioAPct;
  const netB = input.grossReturnPct - input.expenseRatioBPct;
  const n = Math.max(0, Math.round(input.years));

  const fvA = fv(input.lumpsum, input.monthlySip, netA, input.years);
  const fvB = fv(input.lumpsum, input.monthlySip, netB, input.years);

  const series: { year: number; a: number; b: number }[] = [];
  for (let y = 1; y <= n; y++) {
    series.push({ year: y, a: fv(input.lumpsum, input.monthlySip, netA, y), b: fv(input.lumpsum, input.monthlySip, netB, y) });
  }

  const totalInvested = input.lumpsum + input.monthlySip * n * 12;
  const drag = fvB - fvA;
  return {
    totalInvested,
    fvA,
    fvB,
    drag,
    dragPctOfCorpus: fvB > 0 ? (drag / fvB) * 100 : 0,
    netReturnA: netA,
    netReturnB: netB,
    series,
  };
}
