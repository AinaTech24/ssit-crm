import { describe, it, expect } from "vitest";
import { nameKey, parseSheetDate } from "@/lib/gifts/import";

describe("gift sheet dates are day first", () => {
  it("reads the ways an Indian office writes a date", () => {
    for (const v of ["05-11-2026", "5/11/2026", "05.11.26", "5 Nov 2026", "05-Nov-26", "2026-11-05"]) {
      expect(parseSheetDate(v), v).toBe("2026-11-05");
    }
  });
  it("reads a real date cell on its own calendar day", () => {
    expect(parseSheetDate(new Date(2026, 10, 5))).toBe("2026-11-05");
  });
  it("refuses what it cannot read for certain instead of guessing month-first", () => {
    for (const v of ["", "31-02-2026", "11/25/2026", "tomorrow", "5-11"]) expect(parseSheetDate(v), v).toBeNull();
  });
  it("matches names whatever the spacing and capitals", () => {
    expect(nameKey("  Vandana   Ravi IYER ")).toBe("vandana ravi iyer");
  });
});
