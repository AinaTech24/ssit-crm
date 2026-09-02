/**
 * Money-weighted return maths for mutual-fund portfolios.
 *
 * XIRR (extended internal rate of return) is THE number an MFD client asks for:
 * "what's my actual annualised return given I invested at all these different
 * dates?" A simple CAGR can't answer that for a SIP book where money went in
 * monthly. XIRR solves for the single annual rate r that makes the net present
 * value of every dated cashflow equal zero.
 *
 * Sign convention (investor's point of view):
 *   - money OUT of pocket (purchase, SIP installment, STP-in)  → NEGATIVE
 *   - money IN (redemption, dividend payout, SWP, and the CURRENT market value
 *     of units still held, dated today)                        → POSITIVE
 *
 * Pure + dependency-free so it's trivially unit-testable and safe to run on the
 * server or in a worker.
 */

export type CashFlow = { date: Date; amount: number };

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** NPV of dated cashflows at annual rate `rate`, discounting from the first date. */
function npv(rate: number, flows: CashFlow[], t0: number): number {
  let total = 0;
  for (const f of flows) {
    const years = (f.date.getTime() - t0) / MS_PER_YEAR;
    total += f.amount / Math.pow(1 + rate, years);
  }
  return total;
}

/** Derivative of NPV w.r.t. rate — used by Newton-Raphson. */
function dNpv(rate: number, flows: CashFlow[], t0: number): number {
  let total = 0;
  for (const f of flows) {
    const years = (f.date.getTime() - t0) / MS_PER_YEAR;
    total += (-years * f.amount) / Math.pow(1 + rate, years + 1);
  }
  return total;
}

/**
 * Compute XIRR as a decimal (0.12 = 12% p.a.), or null if it can't be solved
 * (e.g. all cashflows same sign, or no convergence). Tries Newton-Raphson for
 * speed, then falls back to bisection for robustness on awkward cashflow sets.
 */
export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  // Need at least one inflow and one outflow, else no root exists.
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();

  // --- Newton-Raphson ---
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const value = npv(rate, sorted, t0);
    if (Math.abs(value) < 1e-7) return clampRate(rate);
    const deriv = dNpv(rate, sorted, t0);
    if (deriv === 0 || !isFinite(deriv)) break;
    const next = rate - value / deriv;
    if (!isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-9) return clampRate(next);
    // Don't let Newton wander below -100% (1+r <= 0 makes pow() explode).
    rate = next <= -0.9999 ? -0.9999 : next;
  }

  // --- Bisection fallback over a wide, sane bracket ---
  let lo = -0.9999;
  let hi = 100; // 10,000% p.a. upper bound — generous for any real fund
  let fLo = npv(lo, sorted, t0);
  let fHi = npv(hi, sorted, t0);
  if (fLo * fHi > 0) return null; // no sign change → no root in bracket
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, sorted, t0);
    if (Math.abs(fMid) < 1e-7) return clampRate(mid);
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return clampRate((lo + hi) / 2);
}

/** Guard against absurd outputs that would only confuse a client UI. */
function clampRate(rate: number): number | null {
  if (!isFinite(rate)) return null;
  // -99.99% .. +1000% — anything outside is a data error, not a return.
  if (rate < -0.9999 || rate > 10) return null;
  return rate;
}

/**
 * Simple absolute (point-to-point) return as a decimal.
 * (current - invested) / invested. Returns null if nothing was invested.
 */
export function absoluteReturn(investedNet: number, currentValue: number): number | null {
  if (!investedNet || investedNet <= 0) return null;
  return (currentValue - investedNet) / investedNet;
}

/**
 * CAGR given a single lump invested `years` ago. For multi-date SIP books use
 * xirr() instead — CAGR can't represent staggered investments.
 */
export function cagr(invested: number, current: number, years: number): number | null {
  if (invested <= 0 || current <= 0 || years <= 0) return null;
  return Math.pow(current / invested, 1 / years) - 1;
}
