/**
 * Scheduler state — last-run watermark + heartbeat per background job.
 *
 * Used for (a) missed-run catch-up so a fixed-time sweep that was skipped while
 * the process was down runs on the next boot, and (b) liveness so a readiness
 * probe can detect a dead/stalled worker.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export async function getLastRun(jobName: string): Promise<Date | null> {
  try {
    return await withSystem(async (tx) => {
      const r = await tx.execute(
        sql`SELECT last_run_at FROM scheduler_state WHERE job_name = ${jobName}`
      );
      const v = (r.rows[0] as any)?.last_run_at;
      return v ? new Date(v) : null;
    });
  } catch {
    return null; // table missing / DB hiccup → treat as "never ran" (safe: catch-up runs)
  }
}

export async function recordRun(jobName: string, status = "ok", detail?: string): Promise<void> {
  try {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO scheduler_state (job_name, last_run_at, last_run_status, last_run_detail, last_heartbeat_at, updated_at)
        VALUES (${jobName}, now(), ${status}, ${detail ?? null}, now(), now())
        ON CONFLICT (job_name) DO UPDATE SET
          last_run_at = now(), last_run_status = ${status}, last_run_detail = ${detail ?? null},
          last_heartbeat_at = now(), updated_at = now()
      `);
    });
  } catch {
    // Never let metadata bookkeeping break the actual job.
  }
}

export async function heartbeat(jobName: string): Promise<void> {
  try {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO scheduler_state (job_name, last_heartbeat_at, updated_at)
        VALUES (${jobName}, now(), now())
        ON CONFLICT (job_name) DO UPDATE SET last_heartbeat_at = now(), updated_at = now()
      `);
    });
  } catch {
    /* best-effort */
  }
}
