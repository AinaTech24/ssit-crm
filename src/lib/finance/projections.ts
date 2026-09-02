/**
 * Business AUM & earnings projection — adopted from Network FP "8.4 Business
 * Projections".
 *
 * Projects an MFD's AUM and commission income forward N years from a small
 * set of assumptions. Pure function, no DB.
 *
 * Model (transparent + financially clean — documented so the owner can trust
 * the numbers rather than a black box):
 *   - New SIP inflow and lumpsum inflow each grow at `growthRatePct` per year.
 *   - The running SIP book accumulates the new SIP inflows on top of the
 *     existing book.
 *   - Total AUM compounds at `marketGrowthPct` each year, and that year's new
 *     SIP + lumpsum inflows are then added.
 *   - Commission income = `commissionRatePct` × year-end AUM.
 *
 * Note: this is an estimate for planning. It deliberately uses a clean
 * compounding recurrence rather than replicating the source spreadsheet's
 * cell formulas verbatim.
 */

export type ProjectionInputs = {
  existingSipBook: number; // monthly SIP book today (₹) — informational running total
  newSipPerYear: number; // new SIP book added in year 1 (₹)
  existingAum: number; // current AUM (₹)
  newLumpsumPerYear: number; // lumpsum added in year 1 (₹)
  growthRatePct: number; // YoY growth of new SIP + lumpsum additions (e.g. 25)
  marketGrowthPct: number; // market appreciation on AUM (e.g. 12)
  commissionRatePct: number; // blended trail/commission on AUM (e.g. 0.75)
  years: number; // horizon (e.g. 10)
  startFyLabel?: string; // e.g. "2025-26"
};

export type ProjectionRow = {
  year: number; // 1-based
  fyLabel: string;
  newSip: number;
  cumulativeSipBook: number;
  lumpsum: number;
  totalAum: number; // year-end AUM after growth + this year's inflows
  estimatedEarnings: number; // commission income for the year
};

export const DEFAULT_PROJECTION_INPUTS: ProjectionInputs = {
  existingSipBook: 1_000_000,
  newSipPerYear: 2_000_000,
  existingAum: 100_000_000,
  newLumpsumPerYear: 20_000_000,
  growthRatePct: 25,
  marketGrowthPct: 12,
  commissionRatePct: 0.75,
  years: 10,
  startFyLabel: "2025-26",
};

/** Advance an "YYYY-YY" FY label by one year. "2025-26" → "2026-27". */
function nextFy(label: string): string {
  const m = label.match(/^(\d{4})-(\d{2})$/);
  if (!m) return label;
  const start = parseInt(m[1], 10) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function projectBusiness(input: ProjectionInputs): ProjectionRow[] {
  const g = input.growthRatePct / 100;
  const m = input.marketGrowthPct / 100;
  const c = input.commissionRatePct / 100;
  const rows: ProjectionRow[] = [];

  let cumulativeSipBook = input.existingSipBook;
  let aum = input.existingAum;
  let fy = input.startFyLabel ?? "Year 1";

  for (let i = 1; i <= input.years; i++) {
    const factor = Math.pow(1 + g, i - 1);
    const newSip = input.newSipPerYear * factor;
    const lumpsum = input.newLumpsumPerYear * factor;

    cumulativeSipBook += newSip;
    // AUM compounds at the market rate, then this year's new money is added.
    aum = aum * (1 + m) + newSip + lumpsum;
    const estimatedEarnings = aum * c;

    rows.push({
      year: i,
      fyLabel: fy,
      newSip,
      cumulativeSipBook,
      lumpsum,
      totalAum: aum,
      estimatedEarnings,
    });
    fy = /^\d{4}-\d{2}$/.test(fy) ? nextFy(fy) : `Year ${i + 1}`;
  }

  return rows;
}

/** Convenience totals for the summary band. */
export function projectionSummary(rows: ProjectionRow[]) {
  const last = rows[rows.length - 1];
  const totalEarnings = rows.reduce((s, r) => s + r.estimatedEarnings, 0);
  return {
    endAum: last?.totalAum ?? 0,
    endEarnings: last?.estimatedEarnings ?? 0,
    endSipBook: last?.cumulativeSipBook ?? 0,
    cumulativeEarnings: totalEarnings,
  };
}
