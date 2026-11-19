import { describe, expect, it } from "vitest";
import { periodRange } from "@/lib/review-meetings/export-period";

describe("meeting export period", () => {
  it("a month runs from its first to its last day, leap years included", () => {
    expect(periodRange("month", 2026, 11, "", "")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("month", 2028, 2, "", "")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("month", 2027, 2, "", "")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(periodRange("month", 2026, 12, "", "")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("a year is the whole calendar year", () => {
    expect(periodRange("year", 2026, 5, "", "")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("custom dates pass through and all-time has no range", () => {
    expect(periodRange("custom", 2026, 1, "2026-03-05", "2026-04-10")).toEqual({ from: "2026-03-05", to: "2026-04-10" });
    expect(periodRange("all", 2026, 1, "", "")).toBeNull();
  });
});
