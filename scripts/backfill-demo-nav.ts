/**
 * backfill-demo-nav — DEMO-DATA CONVENIENCE ONLY.
 *
 * The seeded demo book uses synthetic scheme codes ("HDFC-TOP100", "ICICI-EQ-001")
 * that obviously don't exist in AMFI's feed, so the valuation engine can't price
 * them. Real MFD data imported from CAMS/KFintech carries genuine AMFI codes /
 * ISINs and prices natively — this script is NOT needed in production.
 *
 * For the demo, it maps each unpriced demo scheme code to the best-matching real
 * AMFI scheme by NAME (trigram similarity, preferring the Regular-plan Growth
 * option) and inserts an ALIAS row into scheme_nav keyed by the demo code, so
 * the join in valuation.ts resolves to a real, live NAV. Alias rows are tagged
 * in scheme_name so they're obvious, and they simply go stale after the next
 * `refresh:nav` (they're not in the AMFI feed) — harmless for a demo DB.
 *
 * Usage:  npx tsx scripts/backfill-demo-nav.ts
 */

import "dotenv/config";
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { sql } from "drizzle-orm";
import { withSystem } from "../src/db/client";

async function main() {
  const result = await withSystem(async (tx) => {
    // 1. Distinct (code,name) used by demo transactions/sips that have NO NAV.
    const unpriced = (
      await tx.execute(sql`
        SELECT DISTINCT t.scheme_code, t.scheme_name
        FROM transactions t
        LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
        WHERE t.scheme_code IS NOT NULL
          AND t.scheme_name IS NOT NULL
          AND n.scheme_code IS NULL
      `)
    ).rows as Array<{ scheme_code: string; scheme_name: string }>;

    let mapped = 0;
    const misses: string[] = [];

    for (const row of unpriced) {
      // Strip a trailing "Fund" to widen the trigram match a little.
      const needle = row.scheme_name.replace(/\s+fund\s*$/i, "").trim();

      const best = (
        await tx.execute(sql`
          SELECT scheme_code, scheme_name, nav, nav_date, amc_name,
                 similarity(scheme_name, ${needle}) AS sim
          FROM scheme_nav
          WHERE scheme_name ILIKE ${"%" + needle + "%"}
             OR scheme_name % ${needle}
          ORDER BY
            (scheme_name ILIKE '%growth%') DESC,
            (scheme_name NOT ILIKE '%direct%') DESC,
            (scheme_name NOT ILIKE '%idcw%' AND scheme_name NOT ILIKE '%dividend%') DESC,
            similarity(scheme_name, ${needle}) DESC
          LIMIT 1
        `)
      ).rows[0] as
        | { scheme_code: string; scheme_name: string; nav: string; nav_date: string; amc_name: string | null }
        | undefined;

      if (!best) {
        misses.push(`${row.scheme_code} (${row.scheme_name})`);
        continue;
      }

      await tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, isin, scheme_name, amc_name, nav, nav_date, updated_at)
        VALUES (
          ${row.scheme_code}, NULL,
          ${`[demo→${best.scheme_code}] ${best.scheme_name}`},
          ${best.amc_name}, ${best.nav}, ${best.nav_date}, now()
        )
        ON CONFLICT (scheme_code) DO UPDATE SET
          scheme_name = EXCLUDED.scheme_name,
          amc_name = EXCLUDED.amc_name,
          nav = EXCLUDED.nav,
          nav_date = EXCLUDED.nav_date,
          updated_at = now()
      `);
      mapped++;
      console.log(`  ✓ ${row.scheme_code} → ${best.scheme_code} @ ₹${best.nav}  (${best.scheme_name})`);
    }

    // 2. Normalise demo holding UNITS so they're consistent with the real
    //    NAVs we just aliased in. The seed generated units against synthetic
    //    ~₹10-100 NAVs, so valuing them at real ₹100-5000 NAVs produced absurd
    //    numbers. We back-solve units from the amount invested + a realistic
    //    ~12% p.a. growth over the holding period, so the demo shows a
    //    believable current value + XIRR. (Demo tenant only — real imports
    //    carry true units. Identified by joining to scheme_nav, which only the
    //    synthetic demo codes + AMFI codes share in this DB.)
    const inflow = await tx.execute(sql`
      UPDATE transactions t
      SET units = round((t.amount * (1 + 0.12 * GREATEST(0.1, (CURRENT_DATE - t.order_date) / 365.0)) / n.nav)::numeric, 4),
          nav   = round((n.nav / (1 + 0.12 * GREATEST(0.1, (CURRENT_DATE - t.order_date) / 365.0)))::numeric, 4)
      FROM scheme_nav n
      WHERE n.scheme_code = t.scheme_code
        AND t.direction = 'inflow'
        AND t.amount IS NOT NULL AND t.order_date IS NOT NULL AND n.nav > 0
    `);
    const outflow = await tx.execute(sql`
      UPDATE transactions t
      SET units = round((t.amount / n.nav)::numeric, 4),
          nav   = n.nav
      FROM scheme_nav n
      WHERE n.scheme_code = t.scheme_code
        AND t.direction = 'outflow'
        AND t.amount IS NOT NULL AND n.nav > 0
    `);

    return {
      total: unpriced.length,
      mapped,
      misses,
      normalisedInflow: inflow.rowCount ?? 0,
      normalisedOutflow: outflow.rowCount ?? 0,
    };
  });

  console.log(
    `[backfill-demo-nav] mapped ${result.mapped}/${result.total} demo scheme code(s) to live AMFI NAVs.`
  );
  if (result.misses.length) {
    console.log(`[backfill-demo-nav] no AMFI match for ${result.misses.length}:`);
    for (const m of result.misses) console.log(`    - ${m}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-demo-nav] failed:", err?.message ?? err);
  process.exit(1);
});
