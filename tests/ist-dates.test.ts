import { describe, it, expect } from "vitest";
import { istDay, istDayBounds, localDay } from "@/lib/dates/ist";
import { resolvePeriodRange } from "@/lib/dashboard/period";
import { formatRelative } from "@/lib/utils";

describe("Indian calendar days", () => {
  it("moves to the next day at midnight in India, not in UTC", () => {
    expect(istDay(new Date("2026-11-27T18:29:59Z"))).toBe("2026-11-27");
    expect(istDay(new Date("2026-11-27T18:30:00Z"))).toBe("2026-11-28");
  });
  it("bounds one day from Indian midnight to the next", () => {
    const { start, end } = istDayBounds("2026-11-28");
    expect(start.toISOString()).toBe("2026-11-27T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-28T18:30:00.000Z");
  });
  it("keeps a locally-built date on its own day", () => {
    expect(localDay(new Date(2026, 10, 1))).toBe("2026-11-01");
    const month = resolvePeriodRange("mtd", new Date(2026, 10, 28, 15, 0));
    expect([month.fromDay, month.toDay]).toEqual(["2026-11-01", "2026-11-28"]);
  });
  it("does not call a future time 'just now'", () => {
    expect(formatRelative(new Date(Date.now() + 3 * 3_600_000 + 60_000))).toBe("in 3h");
  });
});
