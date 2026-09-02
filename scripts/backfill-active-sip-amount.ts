/**
 * Backfill investors.active_sip_amount from the live SIP book.
 *
 * This cached column was never recomputed, so the client list's "Monthly SIP",
 * the SIP health card, family suggestions etc. read a stale (usually 0) value.
 * The nightly scanner now keeps it fresh; this one-time pass corrects existing
 * rows. Idempotent. Safe in prod.
 *
 *   npx tsx scripts/backfill-active-sip-amount.ts
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem } from "../src/db/client";

async function main() {
  const res = await withSystem(async (tx) =>
    tx.execute(sql`
      UPDATE investors i SET active_sip_amount = COALESCE((
        SELECT SUM(s.amount::numeric) FROM sips s
        WHERE s.investor_id = i.id AND s.status = 'active'
      ), 0)
      WHERE i.active_sip_amount IS DISTINCT FROM COALESCE((
        SELECT SUM(s.amount::numeric) FROM sips s
        WHERE s.investor_id = i.id AND s.status = 'active'
      ), 0)
    `)
  );
  console.log(`[backfill] active_sip_amount corrected on ${res.rowCount ?? 0} investor(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] failed:", e?.message ?? e);
  process.exit(1);
});
