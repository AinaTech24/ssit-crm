/**
 * Math-convention pinning — the two finance libraries INTENTIONALLY use
 * different compounding conventions, each matching a different published
 * reference sheet:
 *
 *   • goal-planning/calc.ts    → NOMINAL monthly rate (annual/12)
 *   • calculators/sip360.ts    → EFFECTIVE monthly rate ((1+annual)^(1/12)−1)
 *
 * Their identically-named fvSip/fvLumpsum exports are a known import footgun.
 * These tests pin both to reference values so any "helpful unification"
 * refactor (which would silently break rupee-exact parity with the reference
 * sheets) screams immediately.
 */

import { describe, expect, it } from "vitest";
import { fvSip as gpFvSip, fvLumpsum as gpFvLumpsum } from "@/lib/goal-planning/calc";
import { fvSip as c360FvSip, fvLumpsum as c360FvLumpsum, monthlyRate } from "@/lib/calculators/sip360";

describe("goal-planning (NOMINAL annual/12 convention)", () => {
  it("fvSip(10000, 12%, 240 months) — pinned", () => {
    expect(Math.round(gpFvSip(10000, 12, 240))).toBe(9_991_479);
  });
  it("fvLumpsum(100000, 12%, 120 months) — pinned", () => {
    expect(Math.round(gpFvLumpsum(100000, 12, 120))).toBe(330_039);
  });
});

describe("calculators/sip360 (EFFECTIVE (1+r)^(1/12)−1 convention)", () => {
  it("monthlyRate(12) is the effective rate, NOT 0.01", () => {
    expect(monthlyRate(12)).toBeCloseTo(0.00948879293, 9);
    expect(monthlyRate(12)).not.toBeCloseTo(0.01, 5);
  });
  it("fvSip(10000, 12%, 240 months) — pinned", () => {
    expect(Math.round(c360FvSip(10000, 12, 240))).toBe(9_198_574);
  });
  it("fvLumpsum(100000, 12%, 120 months) — pinned (= ×(1.12)^10)", () => {
    expect(Math.round(c360FvLumpsum(100000, 12, 120))).toBe(310_585);
  });
});

describe("the two conventions MUST differ (unification guard)", () => {
  it("same inputs give different FVs — if these ever converge, someone unified the libs", () => {
    expect(Math.round(gpFvSip(10000, 12, 240))).not.toBe(Math.round(c360FvSip(10000, 12, 240)));
    expect(Math.round(gpFvLumpsum(100000, 12, 120))).not.toBe(Math.round(c360FvLumpsum(100000, 12, 120)));
  });
});
