import { describe, expect, it } from "vitest";
import { fvSip } from "@/lib/goal-planning/calc";
import {
  addMonthsUTC,
  assetClassOf,
  historicalSip,
  navOnOrBefore,
  stepUpSip,
  toNavSeries,
  trailingReturn,
  xirr,
  type NavPoint,
} from "@/lib/proposal/report-analytics";

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** A daily NAV series from `start` for `days` days, growing at `annual` per year. */
function series(start: number, days: number, annual: number, nav0 = 10): NavPoint[] {
  return Array.from({ length: days + 1 }, (_, i) => ({ t: start + i * DAY, nav: nav0 * Math.pow(1 + annual, i / 365) }));
}

describe("SIP with a yearly top-up", () => {
  it("totals invested match the sample report (25,000/month for 3 years)", () => {
    expect(Math.round(stepUpSip(25000, 12, 3, 0).invested)).toBe(900000);
    expect(Math.round(stepUpSip(25000, 12, 3, 5).invested)).toBe(945750);
    expect(Math.round(stepUpSip(25000, 12, 3, 10).invested)).toBe(993000);
    expect(Math.round(stepUpSip(25000, 12, 3, 15).invested)).toBe(1041750);
  });

  it("with no top-up it equals the proposal builder's own SIP maths", () => {
    expect(stepUpSip(25000, 12, 3, 0).futureValue).toBeCloseTo(fvSip(25000, 12, 36), 4);
    expect(stepUpSip(10000, 10, 5, 0).futureValue).toBeCloseTo(fvSip(10000, 10, 60), 4);
  });

  it("a higher top-up always ends higher", () => {
    const a = stepUpSip(10000, 12, 5, 0).futureValue;
    const b = stepUpSip(10000, 12, 5, 10).futureValue;
    expect(b).toBeGreaterThan(a);
  });

  it("nothing to project for a zero SIP or term", () => {
    expect(stepUpSip(0, 12, 3, 5)).toEqual({ invested: 0, futureValue: 0 });
    expect(stepUpSip(1000, 12, 0, 5)).toEqual({ invested: 0, futureValue: 0 });
  });
});

describe("XIRR", () => {
  it("is the plain return for one in and one out a year apart", () => {
    const r = xirr([{ t: utc(2025, 1, 1), amount: -100 }, { t: utc(2026, 1, 1), amount: 110 }]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(10, 1);
  });
  it("has no answer without both an outflow and an inflow", () => {
    expect(xirr([{ t: 0, amount: -100 }, { t: DAY, amount: -50 }])).toBeNull();
    expect(xirr([{ t: 0, amount: 100 }])).toBeNull();
  });
});

describe("trailing returns and historical SIP from NAV history", () => {
  it("a NAV that doubles in a year returns about 100% over 1 year", () => {
    const s = series(utc(2024, 11, 17), 365, 1.0); // +100% a year
    expect(trailingReturn(s, 1)!).toBeCloseTo(100, 0);
  });

  it("annualises over longer periods", () => {
    const s = series(utc(2016, 11, 17), 365 * 10 + 3, 0.12);
    expect(trailingReturn(s, 3)!).toBeCloseTo(12, 0);
    expect(trailingReturn(s, 10)!).toBeCloseTo(12, 0);
  });

  it("is null for a period longer than the fund's history", () => {
    const s = series(utc(2024, 11, 17), 365, 0.1);
    expect(trailingReturn(s, 3)).toBeNull();
    expect(historicalSip(s, 3)).toBeNull();
  });

  it("a flat NAV leaves a SIP at what was put in, return about 0", () => {
    const s = series(utc(2023, 11, 1), 365 * 3 + 40, 0);
    const h = historicalSip(s, 3)!;
    expect(h.invested).toBe(360000);
    expect(h.value).toBeCloseTo(360000, -1);
    expect(h.xirr!).toBeCloseTo(0, 0);
  });

  it("a SIP into a rising fund earns roughly the fund's growth rate", () => {
    const s = series(utc(2021, 11, 1), 365 * 5 + 40, 0.12);
    const h = historicalSip(s, 5)!;
    expect(h.invested).toBe(600000);
    expect(h.value).toBeGreaterThan(600000);
    expect(h.xirr!).toBeGreaterThan(10);
    expect(h.xirr!).toBeLessThan(14);
  });
});

describe("helpers", () => {
  it("finds the NAV on or before a day", () => {
    const s: NavPoint[] = [{ t: 10, nav: 1 }, { t: 20, nav: 2 }, { t: 30, nav: 3 }];
    expect(navOnOrBefore(s, 25)).toBe(2);
    expect(navOnOrBefore(s, 30)).toBe(3);
    expect(navOnOrBefore(s, 5)).toBeNull();
  });

  it("moves by months keeping the day, clamped to month end", () => {
    expect(new Date(addMonthsUTC(utc(2026, 3, 31), -1)).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonthsUTC(utc(2026, 11, 17), -12)).toISOString().slice(0, 10)).toBe("2025-11-17");
  });

  it("reads mfapi's newest-first dd-MM-yyyy history into an ascending series", () => {
    const s = toNavSeries([
      { date: "17-11-2026", nav: "12.5" },
      { date: "16-11-2026", nav: "12.0" },
      { date: "bad", nav: "1" },
      { date: "15-11-2026", nav: "0" },
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].nav).toBe(12);
    expect(s[1].nav).toBe(12.5);
  });

  it("puts a scheme in its asset class", () => {
    expect(assetClassOf("Equity: Large Cap")).toBe("Equity Schemes");
    expect(assetClassOf("Hybrid: Aggressive")).toBe("Hybrid Schemes");
    expect(assetClassOf("Debt: Short Duration")).toBe("Debt Schemes");
    expect(assetClassOf("Equity Scheme - Flexi Cap Fund")).toBe("Equity Schemes");
    expect(assetClassOf("Other Scheme - Gold ETF")).toBe("Commodity Schemes");
    expect(assetClassOf(null)).toBe("Other Schemes");
  });
});
