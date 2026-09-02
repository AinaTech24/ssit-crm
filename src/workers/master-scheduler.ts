/**
 * Master scheduler — fires `schedule` triggers when their `next_run_at`
 * arrives. Uses cron-parser to compute next occurrences.
 */

import { sql } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { withSystem, withTenant } from "@/db/client";
import { workflowTriggers } from "@/db/schema";
import { startRun } from "@/lib/workflow/runner";

export async function fireDueSchedules(): Promise<number> {
  let fired = 0;
  const rows = await withSystem(async (tx) => {
    return tx.execute(sql`
      SELECT t.*, w.tenant_id as wf_tenant
      FROM workflow_triggers t
      JOIN workflows w ON w.id = t.workflow_id
      WHERE t.kind = 'schedule'
        AND t.enabled = true
        AND (t.next_run_at IS NULL OR t.next_run_at <= now())
        AND w.enabled = true AND w.paused_at IS NULL
      ORDER BY t.next_run_at NULLS FIRST
      LIMIT 100
    `);
  });

  for (const t of rows.rows as any[]) {
    const cfg = t.config ?? {};
    const cron: string = t.cron_expression ?? cfg.cron;
    if (!cron) continue;
    const tenantId = t.wf_tenant ?? t.tenant_id;

    // 1. Compute the next occurrence and ADVANCE THE WATERMARK FIRST.
    //    Previously next_run_at was only written after startRun succeeded, so a
    //    transient startRun error (or an invalid cron) left the trigger due
    //    (next_run_at <= now()) and it re-fired every 30s tick forever. Claiming
    //    the occurrence up front means the worst case is a single skipped run,
    //    not a runaway loop / send flood. (TODO v2: cfg.subjectQuery should
    //    expand to one run per matching subject; for now schedules fire a single
    //    subject-less run that a workflow `loop` node fans out.)
    let next: Date;
    try {
      next = CronExpressionParser.parse(cron, { tz: cfg.timezone ?? "Asia/Kolkata" }).next().toDate();
    } catch (err) {
      console.error(`[scheduler] trigger ${t.id} has invalid cron '${cron}':`, (err as Error).message);
      continue;
    }
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.execute(
          sql`UPDATE workflow_triggers SET last_run_at = now(), next_run_at = ${next} WHERE id = ${t.id}`
        );
      });
    } catch (err) {
      // Couldn't claim the occurrence — do NOT fire (avoids re-firing a run
      // whose watermark we failed to advance).
      console.error(`[scheduler] trigger ${t.id} watermark update failed:`, (err as Error).message);
      continue;
    }

    // 2. Fire the run. A failure here is logged but the watermark already moved,
    //    so the schedule recovers on the next due time instead of looping.
    try {
      await startRun({
        tenantId,
        workflowId: t.workflow_id,
        triggeredBy: "schedule",
        triggerId: t.id,
      });
      fired++;
    } catch (err) {
      console.error(`[scheduler] trigger ${t.id} startRun failed:`, (err as Error).message);
    }
  }
  return fired;
}

export function startMasterSchedulerWorker() {
  const interval = Number(process.env.MASTER_SCHEDULER_INTERVAL_MS ?? 30_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await fireDueSchedules();
      if (n > 0) console.log(`[scheduler] fired=${n}`);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  console.log(`[scheduler] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
