/**
 * `as any` ratchet. The codebase has accumulated a large number of `as any`
 * casts (baseline below) — each one is a hole in the type system. This is a
 * RATCHET, not a ban: CI fails only if the count GROWS. Lower the baseline as
 * casts are replaced with real types (discriminated unions, $inferSelect rows).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Baseline as of 2026-06-12. Ratchet DOWN, never up. */
const BASELINE = 2450;

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(e)) yield p;
  }
}

let total = 0;
const perFile = [];
for (const f of walk("src")) {
  const m = readFileSync(f, "utf8").match(/\bas any\b/g);
  if (m?.length) {
    total += m.length;
    perFile.push([f, m.length]);
  }
}

console.log(`[check-as-any] total \`as any\` casts in src: ${total}`);
if (process.argv.includes("--list")) {
  for (const [f, n] of perFile.sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${n}\t${f}`);
}

if (total > BASELINE) {
  console.error(
    `[check-as-any] FAIL: ${total} > baseline ${BASELINE}. New \`as any\` casts were added — type the value properly (row types via $inferSelect, discriminated unions for polymorphic shapes) instead.`
  );
  process.exit(1);
}
console.log(`[check-as-any] OK (baseline ${BASELINE})`);
