/**
 * Debt Fund (Hold vs Sell) Benefit Calculator — math engine.
 *
 * Debt funds (under the indexation regime) attract a lower long-term capital
 * gains tax with indexation if held past the LTCG qualification period (3 years).
 * Sell before that and the gain is taxed at the slab rate. This compares:
 *   • SELL TODAY — short-term gain taxed at the slab rate, and
 *   • HOLD to LTCG — value grows for the remaining period, gain is reduced by
 *     indexation and taxed at the (lower) LTCG rate.
 *
 * The headline is the EFFECTIVE post-tax return earned over just the remaining
 * holding period — usually far above the market return, because most of the gain
 * is the tax saved by waiting.
 *
 * CONVENTIONS — actual-days/365 compounding; indexation applied over the whole
 * years held to qualification. Calibrated to the reference case study to the
 * rupee:
 *   ₹10,00,000 on 20/07/2020 · value ₹12,00,000 on 14/11/2022 · index 5% ·
 *   remaining return 6% · ST 30% · LT 20% →
 *     sell today: tax ₹60,000 · net ₹11,40,000 · yield 5.81%
 *     hold to 21/07/2023: redeem ₹12,48,661 · LTCG ₹91,036 · tax ₹18,207 ·
 *     net ₹12,30,454 · yield 7.15% · effective remaining yield 11.84%.
 *
 * NOTE: indexation on debt funds was withdrawn for units bought on/after 1 Apr
 * 2023 — this models the indexation regime and is an illustration only.
 */

export type DebtFundBenefitInput = {
  purchaseDate: string; // ISO yyyy-mm-dd
  investmentAmount: number;
  redemptionDate: string; // "sell today" date (ISO)
  currentMarketValue: number;
  indexationRatePct: number;
  expectedReturnPct: number; // return for the remaining period
  shortTermTaxPct: number;
  longTermTaxPct: number;
  ltcgYears: number; // qualification period (default 3)
};

export type DebtFundBenefitResult = {
  valid: boolean;
  qualifyDate: string; // ISO
  sellHoldingDays: number;
  remainingDays: number;
  totalHoldingDays: number;
  indexYears: number;

  // Sell today
  shortTermGain: number;
  shortTermTax: number;
  netIfSold: number;
  postTaxYieldSold: number; // % p.a.

  // Hold to LTCG
  expectedRedemptionAmount: number;
  indexedCost: number;
  longTermGain: number;
  longTermTax: number;
  netIfHeld: number;
  postTaxYieldHeld: number; // % p.a.

  // Headline: return on the EXTRA holding period
  effectiveRemainingYield: number; // % p.a.
  taxSaved: number;
  extraInHand: number;
};

function parseDate(s: string): Date | null {
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
function toIso(d: Date): string {
  // Format from LOCAL components — toISOString() would shift by the timezone
  // offset and show the previous day for timezones ahead of UTC (e.g. IST).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Annualised return from `from` → `to` over `days` (actual/365). */
function annualise(from: number, to: number, days: number): number {
  if (from <= 0 || days <= 0 || to <= 0) return 0;
  return (Math.pow(to / from, 365 / days) - 1) * 100;
}

export function computeDebtFundBenefit(input: DebtFundBenefitInput): DebtFundBenefitResult {
  const purchase = parseDate(input.purchaseDate);
  const redemption = parseDate(input.redemptionDate);
  const ltcgYears = Math.max(1, Math.round(input.ltcgYears || 3));

  const empty: DebtFundBenefitResult = {
    valid: false, qualifyDate: "", sellHoldingDays: 0, remainingDays: 0, totalHoldingDays: 0, indexYears: 0,
    shortTermGain: 0, shortTermTax: 0, netIfSold: 0, postTaxYieldSold: 0,
    expectedRedemptionAmount: 0, indexedCost: 0, longTermGain: 0, longTermTax: 0, netIfHeld: 0, postTaxYieldHeld: 0,
    effectiveRemainingYield: 0, taxSaved: 0, extraInHand: 0,
  };
  if (!purchase || !redemption) return empty;

  // LTCG qualification date = purchase + ltcgYears years + 1 day (strictly past 3y).
  const qualify = new Date(purchase);
  qualify.setFullYear(qualify.getFullYear() + ltcgYears);
  qualify.setDate(qualify.getDate() + 1);

  const sellHoldingDays = Math.max(1, daysBetween(purchase, redemption));
  const remainingDays = Math.max(0, daysBetween(redemption, qualify));
  const totalHoldingDays = Math.max(1, daysBetween(purchase, qualify));
  const indexYears = Math.floor(totalHoldingDays / 365);

  // ── Sell today (short-term) ──
  const shortTermGain = Math.max(0, input.currentMarketValue - input.investmentAmount);
  const shortTermTax = (shortTermGain * input.shortTermTaxPct) / 100;
  const netIfSold = input.currentMarketValue - shortTermTax;
  const postTaxYieldSold = annualise(input.investmentAmount, netIfSold, sellHoldingDays);

  // ── Hold to LTCG (long-term, with indexation) ──
  const expectedRedemptionAmount =
    input.currentMarketValue * Math.pow(1 + input.expectedReturnPct / 100, remainingDays / 365);
  const indexedCost = input.investmentAmount * Math.pow(1 + input.indexationRatePct / 100, indexYears);
  const longTermGain = Math.max(0, expectedRedemptionAmount - indexedCost);
  const longTermTax = (longTermGain * input.longTermTaxPct) / 100;
  const netIfHeld = expectedRedemptionAmount - longTermTax;
  const postTaxYieldHeld = annualise(input.investmentAmount, netIfHeld, totalHoldingDays);

  // ── Headline: the return on the EXTRA holding period ──
  const effectiveRemainingYield = remainingDays > 0 ? annualise(netIfSold, netIfHeld, remainingDays) : 0;

  return {
    valid: true,
    qualifyDate: toIso(qualify),
    sellHoldingDays,
    remainingDays,
    totalHoldingDays,
    indexYears,
    shortTermGain,
    shortTermTax,
    netIfSold,
    postTaxYieldSold,
    expectedRedemptionAmount,
    indexedCost,
    longTermGain,
    longTermTax,
    netIfHeld,
    postTaxYieldHeld,
    effectiveRemainingYield,
    taxSaved: shortTermTax - longTermTax,
    extraInHand: netIfHeld - netIfSold,
  };
}
