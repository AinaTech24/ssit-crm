/**
 * Hardcoded-color ratchet for the SHARED component layers.
 *
 * The design system lives in CSS variables (globals.css) — `bg-card`,
 * `text-muted-foreground`, `border-border`, `bg-secondary`, brand tokens — and
 * every raw Tailwind palette class (bg-slate-50, text-emerald-900, …) in a
 * shared component bypasses theming and usually breaks dark mode.
 *
 * This is a RATCHET, not a ban: the existing count is grandfathered via
 * BASELINE below; CI fails only if the count GROWS. Lower the baseline as
 * components migrate to tokens. A palette class immediately followed by a
 * `dark:` variant elsewhere in the same class string still counts — the goal
 * is token adoption, but adding dark: variants is the accepted interim fix,
 * so only the light-mode-only count is enforced.
 *
 * Scope: src/components/ui, src/components/common, src/components/layout —
 * the shared layers where one bad color hits every page.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components/ui", "src/components/common", "src/components/layout"];

// Raw palette utilities (bg-/text-/border-/ring- + palette + shade).
const PALETTE =
  /\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;

/** Count grandfathered as of 2026-06-11. Ratchet DOWN as files migrate. */
const BASELINE = 115;

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
for (const root of ROOTS) {
  let count = 0;
  try {
    for (const f of walk(root)) {
      const src = readFileSync(f, "utf8");
      // Strip dark: variants — `dark:bg-rose-950` is the accepted interim fix,
      // only light-mode palette usage is counted.
      const lightOnly = src.replace(/dark:[a-z0-9:\-/[\]().%]+/g, "");
      const m = lightOnly.match(PALETTE);
      if (m?.length) {
        count += m.length;
        perFile.push([f, m.length]);
      }
    }
  } catch {
    /* root may not exist */
  }
  total += count;
}

const baselineFromEnv = Number(process.env.COLOR_BASELINE);
const baseline = Number.isFinite(baselineFromEnv) && baselineFromEnv > 0 ? baselineFromEnv : BASELINE;

console.log(`[check-colors] hardcoded palette classes in shared components: ${total}`);
if (process.argv.includes("--list")) {
  for (const [f, n] of perFile.sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}\t${f}`);
}

if (total > baseline) {
  console.error(
    `[check-colors] FAIL: ${total} > baseline ${baseline}. New hardcoded palette colors were added to shared components — use theme tokens (bg-card, text-muted-foreground, border-border, bg-secondary) or add dark: variants and keep the count flat.`
  );
  process.exit(1);
}
console.log(`[check-colors] OK (baseline ${baseline})`);
