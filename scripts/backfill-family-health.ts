/**
 * Backfill the persisted family-health score for every existing family.
 *
 * Migration 0042 added health_score/health_band/health_scored_at to families
 * with optimistic defaults (100/green/NULL). New + edited families get scored
 * going forward by the app; this one-time pass scores the rows that already
 * existed. The nightly daily-ops scanner keeps them fresh thereafter.
 *
 * Idempotent. Safe in prod.
 *
 * Usage:
 *   npx tsx scripts/backfill-family-health.ts          score all families
 *   npx tsx scripts/backfill-family-health.ts --dry    report, don't write
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

// Cross-tenant maintenance ⇒ needs system (RLS-bypassing) access.
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem } from "../src/db/client";
import { recomputeAllFamilyHealth } from "../src/lib/families/health-persist";

const DRY = process.argv.includes("--dry");

async function main() {
  const now = new Date();

  if (DRY) {
    // Dry mode: compute + report without writing by scoring per tenant inside a
    // rolled-back-style read. Simpler: just report the family count to score.
    const n = await withSystem(async (tx) =>
      Number(((await tx.execute(sql`SELECT count(*)::int AS c FROM families`)).rows[0] as any)?.c ?? 0)
    );
    console.log(`[backfill] (dry) would score ${n} family/families.`);
    process.exit(0);
  }

  // recomputeAllFamilyHealth scopes to the current context; under withSystem it
  // sees every tenant's families (RLS bypassed), so one pass covers all.
  const tally = await withSystem(async (tx) => recomputeAllFamilyHealth(tx, now));

  console.log(
    `[backfill] scored ${tally.scored} family/families — ` +
      `green ${tally.green}, amber ${tally.amber}, red ${tally.red}.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] failed:", e?.message ?? e);
  process.exit(1);
});
