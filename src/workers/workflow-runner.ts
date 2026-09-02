/**
 * Workflow runner worker.
 *
 * Picks up queued runs from `workflow_runs` (status='queued' OR status='paused'
 * AND paused_until <= now()) and executes them step by step. Each step is a
 * separate execute() call that:
 *   1. Loads the run + version + subject
 *   2. Invokes the action handler
 *   3. Persists the outcome and advances current_node_id
 *   4. Re-enqueues itself for the next step (or pauses / completes)
 *
 * Concurrency: per-tenant queue suffix prevents noisy-neighbor at the BullMQ
 * level. We also poll for paused runs whose pause window has elapsed.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { executeStep } from "@/lib/workflow/runner";
import { captureError } from "@/lib/observability/capture";

/**
 * Reap runs stuck in 'running'. If the worker dies between claiming a run
 * (status flipped to 'running') and executeStep persisting an outcome, nothing
 * ever resets the row — it sits 'running' forever and the workflow silently
 * stalls. Detect via step activity: the newest workflow_run_steps timestamp
 * (fall back to started_at/created_at) older than 15 min while still 'running'
 * means the worker died mid-step. Mark FAILED — never re-queue: steps send
 * WhatsApp/email and are not idempotent, so a double-send to a client is worse
 * than a failed run the owner can re-trigger.
 */
export async function reapStalledRuns(): Promise<number> {
  const reaped = await withSystem(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE workflow_runs r
      SET status = 'failed',
          error = 'stalled — worker died mid-step (auto-reaped)',
          completed_at = now()
      WHERE r.status = 'running'
        AND COALESCE(
              (SELECT max(GREATEST(s.started_at, COALESCE(s.completed_at, s.started_at)))
                 FROM workflow_run_steps s
                WHERE s.run_id = r.id),
              r.started_at,
              r.created_at
            ) < now() - interval '15 minutes'
      RETURNING r.id, r.tenant_id, r.workflow_id;
    `);
    return rows.rows as Array<{ id: string; tenant_id: string; workflow_id: string }>;
  });
  for (const r of reaped) {
    captureError("[wf-runner] run reaped as stalled", null, {
      runId: r.id,
      tenantId: r.tenant_id,
      workflowId: r.workflow_id,
    });
  }
  return reaped.length;
}

export async function runNextBatch(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  const claimable = await withSystem(async (tx) => {
    // Atomically claim up to N runs by transitioning queued/awakened paused runs.
    const rows = await tx.execute(sql`
      WITH cte AS (
        SELECT id, tenant_id FROM workflow_runs
        WHERE
          status = 'queued'
          OR (status = 'paused' AND paused_until IS NOT NULL AND paused_until <= now())
        ORDER BY created_at
        LIMIT ${Number(process.env.WORKFLOW_RUNNER_BATCH ?? 50)}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE workflow_runs r
      SET status = 'running'
      FROM cte
      WHERE r.id = cte.id
      RETURNING r.id, r.tenant_id;
    `);
    return rows.rows as Array<{ id: string; tenant_id: string }>;
  });

  for (const r of claimable) {
    try {
      let next = await executeStep({ tenantId: r.tenant_id, runId: r.id });
      let safety = 0;
      // Walk forward while the run can continue immediately. Bail at delay/pause/end.
      while (next.status === "running" && safety < 25) {
        safety++;
        next = await executeStep({ tenantId: r.tenant_id, runId: r.id });
      }
      processed++;
    } catch (err) {
      captureError("[wf-runner] run execution failed", err, { runId: r.id, tenantId: r.tenant_id });
      failed++;
    }
  }
  return { processed, failed };
}

export function startWorkflowRunnerWorker() {
  const interval = Number(process.env.WORKFLOW_RUNNER_INTERVAL_MS ?? 500);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { processed, failed } = await runNextBatch();
      if (processed > 0 || failed > 0) {
        console.log(`[wf-runner] processed=${processed} failed=${failed}`);
      }
    } catch (err) {
      captureError("[wf-runner] tick error", err);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);

  // Stalled-run reaper — every 5 minutes, independent of the fast tick.
  let reaping = false;
  const reapTick = async () => {
    if (reaping) return;
    reaping = true;
    try {
      const n = await reapStalledRuns();
      if (n > 0) console.log(`[wf-runner] reaped ${n} stalled run(s)`);
    } catch (err) {
      captureError("[wf-runner] reaper error", err);
    } finally {
      reaping = false;
    }
  };
  const reapHandle = setInterval(reapTick, 5 * 60 * 1000);

  console.log(`[wf-runner] started (interval=${interval}ms, reaper=5m)`);
  return () => {
    clearInterval(handle);
    clearInterval(reapHandle);
  };
}
