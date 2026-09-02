/**
 * XIRR — annualised return on irregular, dated cashflows.
 *
 * Outflows (investments) are negative, inflows (redemptions, current value)
 * positive. XIRR is the rate that zeroes the time-weighted NPV:
 *   Σ CF_i / (1+rate)^(days_i / 365) = 0
 * Solved by bisection (robust across the full sign range).
 */

export type DatedCashflow = { date: string; amount: number };

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return (b - a) / 86400000;
}

export function xnpv(rate: number, cashflows: DatedCashflow[]): number {
  if (!cashflows.length) return 0;
  const t0 = cashflows[0].date;
  return cashflows.reduce(
    (s, cf) => s + cf.amount / Math.pow(1 + rate, daysBetween(t0, cf.date) / 365),
    0
  );
}

export function xirr(cashflows: DatedCashflow[]): number | null {
  const valid = cashflows.filter((c) => c.date && Number.isFinite(c.amount));
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const hasPos = sorted.some((c) => c.amount > 0);
  const hasNeg = sorted.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return null;

  let lo = -0.9999;
  let hi = 10; // 1000%
  let fLo = xnpv(lo, sorted);
  let fHi = xnpv(hi, sorted);
  let guard = 0;
  while (fLo * fHi > 0 && hi < 1000 && guard < 200) {
    hi *= 1.5;
    fHi = xnpv(hi, sorted);
    guard++;
  }
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpv(mid, sorted);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) hi = mid;
    else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

export type XirrResult = {
  xirrPct: number | null;
  totalInvested: number;
  totalReturned: number;
  netGain: number;
  absoluteReturnPct: number;
};

export function computeXirr(cashflows: DatedCashflow[]): XirrResult {
  const rate = xirr(cashflows);
  const totalInvested = cashflows.filter((c) => c.amount < 0).reduce((s, c) => s + -c.amount, 0);
  const totalReturned = cashflows.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  const netGain = totalReturned - totalInvested;
  return {
    xirrPct: rate === null ? null : rate * 100,
    totalInvested,
    totalReturned,
    netGain,
    absoluteReturnPct: totalInvested > 0 ? (netGain / totalInvested) * 100 : 0,
  };
}
