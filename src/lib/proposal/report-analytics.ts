/**
 * Numbers behind the proposal report that are worked out from a scheme's NAV
 * history (mfapi.in): trailing returns, the historical return of a monthly SIP
 * (XIRR), and the "what if the SIP is topped up every year" projection.
 *
 * All pure functions - no network - so they can be tested against known figures.
 */

import { fetchMfApiScheme, parseMfApiDate } from "@/lib/finance/mfapi";

export type NavPoint = { t: number; nav: number }; // t = epoch ms, ascending

const DAY = 86_400_000;

/** mfapi's history (newest first, dd-MM-yyyy) -> ascending points. */
export function toNavSeries(data: Array<{ date: string; nav: string }> | undefined | null): NavPoint[] {
  return (data ?? [])
    .map((p) => {
      const iso = parseMfApiDate(p.date);
      const nav = Number(p.nav);
      return iso && Number.isFinite(nav) && nav > 0 ? { t: new Date(`${iso}T00:00:00Z`).getTime(), nav } : null;
    })
    .filter((p): p is NavPoint => !!p)
    .sort((a, b) => a.t - b.t);
}

/** NAV on the given day, or the closest earlier one. Null if the series starts later. */
export function navOnOrBefore(series: NavPoint[], t: number): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let best: NavPoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) {
      best = series[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best ? best.nav : null;
}

/** The same day-of-month `n` months before `t` (clamped to the month's last day). */
export function addMonthsUTC(t: number, n: number): number {
  const d = new Date(t);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.getTime();
}

/** Point-to-point annualised return (%) over `years`, or null without enough history. */
export function trailingReturn(series: NavPoint[], years: number): number | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const start = addMonthsUTC(latest.t, -12 * years);
  if (series[0].t > start + 7 * DAY) return null; // the fund is younger than the period
  const past = navOnOrBefore(series, start);
  if (past == null || past <= 0) return null;
  return (Math.pow(latest.nav / past, 1 / years) - 1) * 100;
}

/**
 * XIRR (%) of dated cash flows (negative = money in). Newton's method, falling back to
 * bisection; null when there is no sign change or no solution.
 */
export function xirr(flows: Array<{ t: number; amount: number }>): number | null {
  if (flows.length < 2) return null;
  const hasNeg = flows.some((f) => f.amount < 0);
  const hasPos = flows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const t0 = flows[0].t;
  const npv = (r: number) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.t - t0) / (365 * DAY)), 0);
  // bisection on a wide bracket - slower than Newton but cannot diverge
  let lo = -0.99;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid * 100;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return ((lo + hi) / 2) * 100;
}

export type SipHistory = { invested: number; value: number; xirr: number | null };

/**
 * What a monthly SIP of `monthly` would have become over the last `years`: one
 * instalment on the same day each month, bought at that day's NAV, valued at the
 * latest NAV. Null when the fund has not been around that long.
 */
export function historicalSip(series: NavPoint[], years: number, monthly = 10_000): SipHistory | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const first = addMonthsUTC(latest.t, -12 * years);
  if (series[0].t > first + 7 * DAY) return null;
  const flows: Array<{ t: number; amount: number }> = [];
  let units = 0;
  for (let i = 0; i < 12 * years; i++) {
    const t = addMonthsUTC(first, i);
    const nav = navOnOrBefore(series, t);
    if (nav == null) return null;
    units += monthly / nav;
    flows.push({ t, amount: -monthly });
  }
  const value = units * latest.nav;
  flows.push({ t: latest.t, amount: value });
  return { invested: monthly * 12 * years, value, xirr: xirr(flows) };
}

/**
 * SIP with the instalment raised by `topUpPct` at the start of every year, paid at the
 * start of each month (annuity-due), monthly rate = annual / 12 - the same convention
 * the proposal builder uses for a plain SIP, so a 0% top-up equals the builder's figure.
 */
export function stepUpSip(
  monthly: number,
  annualReturnPct: number,
  years: number,
  topUpPct: number
): { invested: number; futureValue: number } {
  if (monthly <= 0 || years <= 0) return { invested: 0, futureValue: 0 };
  const m = annualReturnPct / 100 / 12;
  let balance = 0;
  let invested = 0;
  let amount = monthly;
  const months = Math.round(years * 12);
  for (let i = 0; i < months; i++) {
    if (i > 0 && i % 12 === 0) amount *= 1 + topUpPct / 100;
    balance = (balance + amount) * (1 + m);
    invested += amount;
  }
  return { invested, futureValue: balance };
}

/** Asset class shown in the allocation table, read from the scheme's category text. */
export function assetClassOf(category: string | null | undefined): string {
  const c = (category ?? "").toLowerCase();
  if (/gold|silver|commodit/.test(c)) return "Commodity Schemes"; // before equity: "Gold ETF" is not equity
  if (/hybrid|balanced|arbitrage|asset allocation/.test(c)) return "Hybrid Schemes";
  if (/equity|elss|index|etf|large cap|mid cap|small cap|flexi|multi cap|focused|value|contra|sectoral|thematic/.test(c)) return "Equity Schemes";
  if (/debt|bond|gilt|liquid|money market|overnight|duration|credit|income|floater|banking and psu|corporate/.test(c)) return "Debt Schemes";
  if (/international|global|fof|overseas/.test(c)) return "International Schemes";
  return "Other Schemes";
}

export type SchemeAnalytics = {
  /** AMFI/mfapi scheme code the figures belong to. */
  code: string;
  inceptionDate: string | null;
  returns: { y1: number | null; y3: number | null; y5: number | null; y10: number | null };
  sip: { y1: SipHistory | null; y3: SipHistory | null; y5: SipHistory | null; y10: SipHistory | null };
};

export function analyseSeries(code: string, series: NavPoint[]): SchemeAnalytics {
  const sip = (y: number) => historicalSip(series, y);
  return {
    code,
    inceptionDate: series.length ? new Date(series[0].t).toISOString().slice(0, 10) : null,
    returns: {
      y1: trailingReturn(series, 1),
      y3: trailingReturn(series, 3),
      y5: trailingReturn(series, 5),
      y10: trailingReturn(series, 10),
    },
    sip: { y1: sip(1), y3: sip(3), y5: sip(5), y10: sip(10) },
  };
}

/**
 * Fetch NAV history for each scheme code (in parallel, bounded by one overall time
 * limit) and analyse it. A scheme whose history can't be fetched is simply left out -
 * the report then shows the sections it can, never an error.
 */
export async function loadSchemeAnalytics(codes: string[], timeoutMs = 14_000): Promise<Map<string, SchemeAnalytics>> {
  const out = new Map<string, SchemeAnalytics>();
  const unique = [...new Set(codes.map((c) => String(c ?? "").replace(/[^0-9A-Za-z]/g, "")).filter(Boolean))].slice(0, 12);
  if (!unique.length) return out;
  const work = Promise.all(
    unique.map(async (code) => {
      try {
        const s = await fetchMfApiScheme(code);
        const series = toNavSeries(s?.data);
        if (series.length >= 2) out.set(code, analyseSeries(code, series));
      } catch {
        /* leave this scheme out */
      }
    })
  );
  await Promise.race([work, new Promise((res) => setTimeout(res, timeoutMs))]);
  return out;
}
