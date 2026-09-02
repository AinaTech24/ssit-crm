/**
 * Finance math assertions — the money calculations clients depend on. Pure
 * functions only (no DB), runnable via `tsx`. Wired into `npm test` + CI.
 *
 *   npx tsx scripts/check-finance-math.ts
 *
 * Covers: XIRR (Newton/bisection), absolute return, and the FIFO realized
 * capital-gains engine (STCG/LTCG split, ₹1.25L LTCG exemption).
 */

import { xirr, absoluteReturn, cagr } from "../src/lib/finance/xirr";
import { fifoRealizedGains, type TxRow } from "../src/lib/tax/realized-gains";

let passed = 0;
let failed = 0;

function approx(actual: number | null, expected: number, tol: number, label: string) {
  if (actual == null || Math.abs(actual - expected) > tol) {
    console.error(`  ✗ ${label}: got ${actual}, expected ~${expected} (±${tol})`);
    failed++;
  } else {
    passed++;
  }
}
function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failed++;
  } else {
    passed++;
  }
}

// ── XIRR ───────────────────────────────────────────────────────────────────
console.log("XIRR:");
// Invest 1,00,000 today, worth 1,10,000 in exactly one year → ~10% p.a.
approx(
  xirr([
    { date: new Date("2024-01-01"), amount: -100000 },
    { date: new Date("2025-01-01"), amount: 110000 },
  ]),
  0.10,
  0.005,
  "10% one-year return"
);
// Flat: invest and redeem same amount → ~0%.
approx(
  xirr([
    { date: new Date("2024-01-01"), amount: -100000 },
    { date: new Date("2025-01-01"), amount: 100000 },
  ]),
  0,
  0.005,
  "0% flat"
);
// Doubling in one year → ~100% p.a.
approx(
  xirr([
    { date: new Date("2024-01-01"), amount: -50000 },
    { date: new Date("2025-01-01"), amount: 100000 },
  ]),
  1.0,
  0.02,
  "100% (doubled in a year)"
);
// Degenerate inputs return null, never throw.
eq(xirr([]), null, "empty cashflows → null");
eq(xirr([{ date: new Date("2024-01-01"), amount: -100 }]), null, "all-negative → null");

// ── absolute return + CAGR ───────────────────────────────────────────────
console.log("Absolute return / CAGR:");
approx(absoluteReturn(100000, 125000), 0.25, 1e-9, "25% absolute");
approx(absoluteReturn(100000, 100000), 0, 1e-9, "0% absolute");
approx(cagr(100000, 200000, 1), 1.0, 1e-6, "CAGR double in 1y = 100%");

// ── FIFO realized capital gains ──────────────────────────────────────────
console.log("FIFO realized gains:");
function buy(date: string, units: number, nav: number): TxRow {
  return { scheme_code: "S1", scheme_name: "Fund A", type: "purchase", direction: "inflow", units: String(units), nav: String(nav), amount: String(units * nav), order_date: date };
}
function sell(date: string, units: number, nav: number): TxRow {
  return { scheme_code: "S1", scheme_name: "Fund A", type: "redemption", direction: "outflow", units: String(units), nav: String(nav), amount: String(units * nav), order_date: date };
}

// Short-term: buy 100@10, sell 100@12 four months later, in FY2024-25.
{
  const g = fifoRealizedGains([buy("2024-05-01", 100, 10), sell("2024-09-01", 100, 12)], 2024);
  approx(g.stcg, 200, 0.01, "STCG = (12-10)*100");
  approx(g.ltcg, 0, 0.01, "no LTCG");
  eq(g.rows.length, 1, "one realized row");
  eq(g.rows[0]?.term, "stcg", "row tagged STCG");
}

// Long-term: buy 100@10, sell 100@20 fourteen months later → LTCG 1000,
// fully within the ₹1.25L exemption so taxable = 0.
{
  const g = fifoRealizedGains([buy("2023-05-01", 100, 10), sell("2024-07-01", 100, 20)], 2024);
  approx(g.ltcg, 1000, 0.01, "LTCG = (20-10)*100");
  approx(g.stcg, 0, 0.01, "no STCG");
  approx(g.ltcgTaxable, 0, 0.01, "LTCG within exemption → 0 taxable");
  eq(g.rows[0]?.term, "ltcg", "row tagged LTCG");
}

// FIFO ordering: two buy lots, partial sell consumes the OLDEST lot first.
{
  const g = fifoRealizedGains(
    [buy("2024-04-10", 100, 10), buy("2024-06-10", 100, 15), sell("2024-08-10", 100, 20)],
    2024
  );
  // Sold 100 units; FIFO matches the 100@10 lot → gain (20-10)*100 = 1000 STCG.
  approx(g.stcg, 1000, 0.01, "FIFO consumes oldest lot (gain 1000)");
  eq(g.rows.length, 1, "one matched lot");
}

// LTCG above exemption → taxable is the excess.
{
  // buy 100000 units @10 (₹10L), sell @ 12.5 after >1y → LTCG 2,50,000; taxable = 2.5L-1.25L = 1.25L
  const g = fifoRealizedGains([buy("2023-01-01", 100000, 10), sell("2024-06-01", 100000, 12.5)], 2024);
  approx(g.ltcg, 250000, 1, "LTCG 2.5L");
  approx(g.ltcgTaxable, 125000, 1, "taxable = LTCG - 1.25L exemption");
}

// Sells outside the requested FY are excluded.
{
  const g = fifoRealizedGains([buy("2024-05-01", 100, 10), sell("2026-09-01", 100, 12)], 2024);
  eq(g.rows.length, 0, "redemption in a later FY excluded");
  approx(g.stcg, 0, 0.01, "no gains in FY2024-25");
}

console.log(`\n[check-finance-math] ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
