/**
 * Proposal line-item projections — one source of truth for the money math
 * shown in the builder, the detail page, the print/PDF and the saved totals.
 *
 * Conventions (kept stable so existing proposals don't shift):
 *   - SIP            → annuity-due, monthly compounding (reuses the verified
 *                      `fvSip` helper — identical to the builder's formula).
 *   - Lumpsum / PMS / AIF / Other → annual compounding `amt·(1+r)^years`
 *                      (matches the existing builder + PMS/AIF math).
 *   - Insurance is protection, not an investment → no projected value.
 */

import { fvSip } from "@/lib/goal-planning/calc";

export type AnyLineItem = Record<string, any> & { kind: string };

/** Annual-compounded future value of a one-time amount. */
export function fvLumpAnnual(amount: number, ratePct: number, years: number): number {
  if (amount <= 0) return 0;
  if (ratePct <= 0 || years <= 0) return amount;
  return amount * Math.pow(1 + ratePct / 100, years);
}

/** The cash outlay a line item represents — drives the "Total investment" KPI. */
export function lineItemInvestment(it: AnyLineItem): number {
  switch (it.kind) {
    case "mf": {
      let v = Number(it.lumpsum ?? 0);
      if (it.monthlyAmount && it.sipTermYears) {
        v += Number(it.monthlyAmount) * 12 * Number(it.sipTermYears);
      }
      return v;
    }
    case "insurance":
      return Number(it.annualPremium ?? 0);
    case "pms":
    case "aif":
      return Number(it.proposedAmount ?? 0);
    case "other":
      return Number(it.amount ?? 0);
    default:
      return 0;
  }
}

/**
 * Expected future value of a line item, or null when it can't be projected
 * (insurance, or an item missing return/horizon). For MF this sums the
 * lumpsum (annual) and SIP (annuity-due monthly) legs.
 */
export function lineItemFutureValue(it: AnyLineItem): number | null {
  switch (it.kind) {
    case "mf": {
      const r = Number(it.expectedReturn ?? 0);
      const years = Number(it.sipTermYears ?? 0);
      if (r <= 0 || years <= 0) {
        return it.projectedCorpus ? Number(it.projectedCorpus) : null;
      }
      const months = Math.round(years * 12);
      const fv =
        fvLumpAnnual(Number(it.lumpsum ?? 0), r, years) +
        fvSip(Number(it.monthlyAmount ?? 0), r, months);
      return fv > 0 ? Math.round(fv) : null;
    }
    case "pms": {
      const amt = Number(it.proposedAmount ?? 0);
      const r = Number(it.expectedReturn ?? 0);
      const y = Number(it.termYears ?? 0);
      return amt > 0 && r > 0 && y > 0 ? Math.round(fvLumpAnnual(amt, r, y)) : null;
    }
    case "aif": {
      const amt = Number(it.proposedAmount ?? 0);
      const r = Number(it.targetIrr ?? 0);
      const y = Number(it.lockInYears ?? 0);
      return amt > 0 && r > 0 && y > 0 ? Math.round(fvLumpAnnual(amt, r, y)) : null;
    }
    case "other": {
      const amt = Number(it.amount ?? 0);
      const r = Number(it.expectedReturn ?? 0);
      const y = Number(it.termYears ?? 0);
      return amt > 0 && r > 0 && y > 0 ? Math.round(fvLumpAnnual(amt, r, y)) : null;
    }
    default:
      return null; // insurance — protection, not projected
  }
}

/** Total amount invested across SIP leg for an MF line (for the SIP table). */
export function sipTotalInvested(it: AnyLineItem): number {
  if (it.kind !== "mf") return 0;
  return Number(it.monthlyAmount ?? 0) * 12 * Number(it.sipTermYears ?? 0);
}

/** Aggregate totals across all line items — used by the API at save time. */
export function proposalTotals(items: AnyLineItem[]): {
  totalInvestment: number | null;
  expectedCorpus: number | null;
} {
  let inv = 0;
  let corpus = 0;
  for (const it of items ?? []) {
    inv += lineItemInvestment(it);
    const fv = lineItemFutureValue(it);
    if (fv) corpus += fv;
  }
  return { totalInvestment: inv || null, expectedCorpus: corpus || null };
}
