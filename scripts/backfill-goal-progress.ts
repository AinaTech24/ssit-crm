/**
 * Backfill goal progress for every existing goal.
 *
 * Migration 0044 added expected_progress_pct (NULL) and the recompute engine
 * now refreshes required-SIP / gap / progress / status nightly. This one-time
 * pass recomputes every goal that existed before, so the list + the
 * goal_drift_alert recipe have correct, current numbers immediately rather than
 * waiting for the first nightly run.
 *
 * Idempotent. Safe in prod.
 *
 *   npx tsx scripts/backfill-goal-progress.ts          recompute all goals
 *   npx tsx scripts/backfill-goal-progress.ts --dry    report count, no writes
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem } from "../src/db/client";
import { recomputeAllGoals } from "../src/lib/goal-planning/recompute";

const DRY = process.argv.includes("--dry");

async function main() {
  if (DRY) {
    const n = await withSystem(async (tx) =>
      Number(((await tx.execute(sql`SELECT count(*)::int AS c FROM goals`)).rows[0] as any)?.c ?? 0)
    );
    console.log(`[backfill] (dry) would recompute ${n} goal(s).`);
    process.exit(0);
  }

  // Under withSystem (RLS bypassed) recomputeAllGoals sees every tenant's goals,
  // so one pass covers the whole platform.
  const t = await withSystem(async (tx) => recomputeAllGoals(tx, new Date()));
  console.log(
    `[backfill] recomputed ${t.recomputed} goal(s) — on-track ${t.onTrack}, behind ${t.behind}, achieved ${t.achieved}.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] failed:", e?.message ?? e);
  process.exit(1);
});
