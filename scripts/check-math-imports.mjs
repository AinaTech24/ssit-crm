/**
 * Math-convention import guard.
 *
 * Two finance libraries coexist ON PURPOSE, each matching a different published
 * reference sheet:
 *   • src/lib/goal-planning/calc.ts   — NOMINAL monthly rate (annual/12)
 *   • src/lib/calculators/*           — EFFECTIVE rate ((1+annual)^(1/12)−1)
 * Both export identically-named fvSip/fvLumpsum. Importing BOTH into one file
 * is how silent convention-mixing bugs happen (results drift by 10-20 bps/yr
 * and no longer match either reference sheet).
 *
 * Rule: a single file may import from goal-planning/calc OR from a
 * lib/calculators math module — never both. (tests/ are exempt: the
 * convention-pinning test compares them deliberately.)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(e)) yield p;
  }
}

const GP = /from\s+["']@\/lib\/goal-planning\/calc["']/;
// EFFECTIVE-rate engine modules (they define or import sip360's monthlyRate).
// NOTE: lib/calculators also hosts nominal-convention helpers (conversion.ts,
// advisory.ts wrap goal-planning/calc) — those are deliberately NOT listed.
const EFFECTIVE = /from\s+["'][^"']*(sip360|stepup-reckoner|multipurpose|swp-end-period|swp-comprehensive|swp-periodic|stp-comprehensive|goal-planner|goal-collision|goal-feasibility|child-education|crash-stress|fire|hlv|insurance-irr|tax-harvesting|expense-drag|annual-lumpsum-required|income-bridge|salary-wealth)["']/;

const offenders = [];
for (const f of walk("src")) {
  const src = readFileSync(f, "utf8");
  if (GP.test(src) && EFFECTIVE.test(src)) offenders.push(f);
}

if (offenders.length) {
  console.error(
    "[check-math-imports] FAIL — these files import BOTH math conventions (nominal goal-planning AND effective lib/calculators); pick one per file:"
  );
  for (const f of offenders) console.error(`  ${f}`);
  process.exit(1);
}
console.log("[check-math-imports] OK — no file mixes the two math conventions.");
