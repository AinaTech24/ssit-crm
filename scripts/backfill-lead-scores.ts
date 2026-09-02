/**
 * Backfill the deterministic lead score for every existing lead.
 *
 * Migration 0040 added lead_score/score_band/scored_at with defaults (0/cold/
 * NULL). New + transitioned leads get scored going forward by the app, but
 * rows that already existed need a one-time pass. This script scores every
 * lead cross-tenant and writes the three columns.
 *
 * Idempotent: re-running simply recomputes the same numbers. Safe in prod.
 *
 * Usage:
 *   npx tsx scripts/backfill-lead-scores.ts            score all leads
 *   npx tsx scripts/backfill-lead-scores.ts --dry      report, don't write
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

// Cross-tenant maintenance ⇒ legitimately needs system (RLS-bypassing) access.
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem } from "../src/db/client";
import { scoreLead } from "../src/lib/leads/score";

const DRY = process.argv.includes("--dry");
const BATCH = 500;

async function main() {
  const now = Date.now();
  let offset = 0;
  let total = 0;
  const bandTally: Record<string, number> = { hot: 0, warm: 0, cold: 0 };

  // Pull the columns the scorer reads. Ordered by id for a stable page window.
  for (;;) {
    const page = await withSystem(async (tx) =>
      (
        await tx.execute(sql`
          SELECT id, source, stage, intended_amount, last_contact_at,
                 next_follow_up_at, stage_changed_at, created_at,
                 email, phone, pan, interest_products
          FROM leads
          ORDER BY id
          LIMIT ${BATCH} OFFSET ${offset}
        `)
      ).rows as any[]
    );
    if (page.length === 0) break;

    for (const r of page) {
      const { score, band } = scoreLead(
        {
          source: r.source,
          stage: r.stage,
          intendedAmount: r.intended_amount,
          lastContactAt: r.last_contact_at,
          nextFollowUpAt: r.next_follow_up_at,
          stageChangedAt: r.stage_changed_at,
          createdAt: r.created_at,
          email: r.email,
          phone: r.phone,
          pan: r.pan,
          interestProducts: r.interest_products,
        },
        now
      );
      bandTally[band] = (bandTally[band] ?? 0) + 1;
      total++;

      if (!DRY) {
        await withSystem(async (tx) => {
          await tx.execute(sql`
            UPDATE leads
               SET lead_score = ${score}, score_band = ${band}, scored_at = now()
             WHERE id = ${r.id}::uuid
          `);
        });
      }
    }

    process.stdout.write(`[backfill] scored ${total} …\r`);
    offset += BATCH;
  }

  console.log(
    `\n[backfill] ${DRY ? "(dry) would score" : "scored"} ${total} lead(s) — ` +
      `hot ${bandTally.hot}, warm ${bandTally.warm}, cold ${bandTally.cold}.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[backfill] failed:", e?.message ?? e);
  process.exit(1);
});
