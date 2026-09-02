/**
 * Scheduled communications drain.
 *
 * Compose lets an RM schedule an email for later — that lands a
 * `communications` row with status='scheduled' + scheduled_at. This worker
 * ticks every minute, finds due rows across all tenants, and fires each one in
 * place via sendScheduledEmail() (which re-checks consent + compliance before
 * the adapter call — consent can be revoked between scheduling and sending).
 *
 * Each row is processed in its own system transaction so one failure can't roll
 * back the rest of the batch. The `comms_scheduled_idx` makes the due-scan cheap.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { communications } from "@/db/schema";
import { sendScheduledEmail } from "@/lib/comms/compose";
import { captureError } from "@/lib/observability/capture";

const BATCH = 200;

export async function runScheduledCommsDrain(): Promise<{ picked: number; sent: number; skipped: number; failed: number }> {
  // 1. Atomically CLAIM due rows: flip scheduled → queued in one statement,
  //    locking the candidate set with FOR UPDATE SKIP LOCKED so overlapping
  //    ticks (or a second worker process) can't both grab the same row and
  //    double-send. Only the ids we actually claimed are returned.
  const due = await withSystem(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE communications
      SET status = 'queued', queued_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM communications
        WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);
    return (rows.rows as Array<{ id: string }>).map((r) => r.id);
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // 2. Fire each in its own transaction.
  for (const id of due) {
    try {
      const res = await withSystem(async (tx) => sendScheduledEmail(tx, id));
      if (res.status === "sent" || res.status === "queued") sent++;
      else if (res.status === "skipped") skipped++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(`[scheduled-comms] send failed for ${id}:`, (err as Error).message);
    }
  }

  if (due.length) {
    console.log(`[scheduled-comms] drained ${due.length} due (sent=${sent} skipped=${skipped} failed=${failed})`);
  }
  return { picked: due.length, sent, skipped, failed };
}

/** Self-scheduled 60s tick. Returns a stop fn (matches the other workers). */
export function startScheduledCommsWorker(): () => void {
  const interval = setInterval(() => {
    void runScheduledCommsDrain().catch((err) =>
      captureError("[scheduled-comms] tick failed", err)
    );
  }, 60 * 1000);
  interval.unref?.();
  console.log("[scheduled-comms] armed — draining due scheduled sends every 60s");
  return () => clearInterval(interval);
}
