import { describe, it, expect } from "vitest";
import { colsFor, pruneEmptyCols, isBlankCell } from "@/lib/proposal/proposal-pdf";

/**
 * A proposal PDF used to carry a column for every field the product KIND could
 * have, whether or not this particular proposal filled any of them — so a
 * lumpsum-only plan printed "SIP/mo" and "Term" columns of dashes. The reader
 * cannot tell a column that does not apply from one somebody forgot to fill in,
 * and it costs width the real columns need.
 */
describe("proposal PDF — empty column pruning", () => {
  const headers = (cols: ReturnType<typeof colsFor>) => cols.map((c) => c.h);

  it("drops columns that are empty on every row", () => {
    const items = [
      { kind: "mf", schemeName: "HDFC Top 100", amcName: "HDFC", lumpsum: 300000, expectedReturn: 12, projectedCorpus: 540000 },
      { kind: "mf", schemeName: "SBI Small Cap", amcName: "SBI", lumpsum: 200000, expectedReturn: 14, projectedCorpus: 360000 },
    ];
    const kept = headers(pruneEmptyCols(colsFor("mf"), items));
    expect(kept).toContain("Lumpsum");
    expect(kept).toContain("Return");
    // Nothing in this proposal is a SIP, so neither column has a single value.
    expect(kept).not.toContain("SIP/mo");
    expect(kept).not.toContain("Term");
  });

  it("keeps a column when even one row has a value", () => {
    const items = [
      { kind: "mf", schemeName: "A", amcName: "X", lumpsum: 100000 },
      { kind: "mf", schemeName: "B", amcName: "Y", monthlyAmount: 5000 },
    ];
    const kept = headers(pruneEmptyCols(colsFor("mf"), items));
    expect(kept).toContain("Lumpsum");
    expect(kept).toContain("SIP/mo");
  });

  it("keeps every column when the proposal is fully filled", () => {
    const items = [
      {
        kind: "mf", schemeName: "A", amcName: "X",
        lumpsum: 100000, monthlyAmount: 5000, sipTermYears: 10,
        expectedReturn: 12, projectedCorpus: 500000,
      },
    ];
    expect(headers(pruneEmptyCols(colsFor("mf"), items))).toEqual(headers(colsFor("mf")));
  });

  it("re-normalises widths so the surviving columns still fill the table", () => {
    const items = [{ kind: "mf", schemeName: "A", amcName: "X", lumpsum: 100000 }];
    const kept = pruneEmptyCols(colsFor("mf"), items);
    const total = kept.reduce((a, c) => a + c.w, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("keeps the first column even when blank — rows need a label", () => {
    const items = [{ kind: "mf", lumpsum: 100000 }];
    expect(headers(pruneEmptyCols(colsFor("mf"), items))[0]).toBe("Scheme");
  });

  it("leaves an empty product list alone rather than pruning to nothing", () => {
    expect(pruneEmptyCols(colsFor("mf"), [])).toHaveLength(colsFor("mf").length);
  });

  it("treats blanks, dashes and em-dashes as empty", () => {
    expect(isBlankCell("")).toBe(true);
    expect(isBlankCell("  ")).toBe(true);
    expect(isBlankCell("-")).toBe(true);
    expect(isBlankCell("—")).toBe(true);
    expect(isBlankCell("0")).toBe(false);
    expect(isBlankCell("Rs 1,000")).toBe(false);
  });

  it("prunes insurance columns on the same rule", () => {
    const items = [{ kind: "insurance", policyName: "Term Plan", insurer: "HDFC Life", sumAssured: 10000000 }];
    const kept = headers(pruneEmptyCols(colsFor("insurance"), items));
    expect(kept).toContain("Policy");
    expect(kept).toContain("Sum Assured");
    expect(kept).not.toContain("Premium");
    expect(kept).not.toContain("Term");
  });
});
