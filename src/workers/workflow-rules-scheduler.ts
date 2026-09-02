/**
 * Workflow Rules Scheduler Worker.
 *
 * Polls `workflow_rule_scheduled_jobs` for pending actions where `run_at <= now()`.
 * Resolves the subject record dynamically using its module's table, executes the action,
 * and updates the job status (completed, failed, or cancelled).
 */

import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { workflowRuleScheduledJobs } from "@/db/schema";
import { executeAction } from "@/lib/workflow-rules/actions";
import { getModule } from "@/lib/workflow-rules/modules";

export async function fireDueScheduledRuleJobs(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Claim pending jobs where runAt <= now() across all tenants
  const claimable = await withSystem(async (tx) => {
    const rows = await tx.execute(sql`
      WITH cte AS (
        SELECT id FROM workflow_rule_scheduled_jobs
        WHERE status = 'pending' AND run_at <= now()
        ORDER BY run_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      )
      UPDATE workflow_rule_scheduled_jobs j
      SET status = 'running', updated_at = now()
      FROM cte
      WHERE j.id = cte.id
      RETURNING j.id, j.tenant_id;
    `);
    return rows.rows as Array<{ id: string; tenant_id: string }>;
  });

  for (const job of claimable) {
    try {
      await withTenant(job.tenant_id, async (tx) => {
        // Load the full job record
        const [fullJob] = await tx
          .select()
          .from(workflowRuleScheduledJobs)
          .where(
            and(
              eq(workflowRuleScheduledJobs.id, job.id),
              eq(workflowRuleScheduledJobs.tenantId, job.tenant_id)
            )
          );

        if (!fullJob) {
          throw new Error("Job not found");
        }

        // Fetch the subject record dynamically using its module table
        const moduleKey = subjectTypeToModule(fullJob.subjectType);
        const mod = moduleKey ? getModule(moduleKey) : null;
        if (!mod) {
          throw new Error(`Unknown module for subjectType: ${fullJob.subjectType}`);
        }

        const subjectRows = await tx.execute(
          sql`SELECT * FROM ${sql.identifier(mod.table)} WHERE id = ${fullJob.subjectId} AND tenant_id = ${fullJob.tenantId}::uuid LIMIT 1`
        );
        const record = subjectRows.rows[0] as Record<string, unknown> | undefined;

        if (!record) {
          // If record no longer exists, cancel the job
          await tx
            .update(workflowRuleScheduledJobs)
            .set({
              status: "cancelled",
              cancelReason: "Subject record no longer exists",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workflowRuleScheduledJobs.id, job.id),
                eq(workflowRuleScheduledJobs.tenantId, job.tenant_id)
              )
            );
          return;
        }

        // Run the action
        const result = await executeAction(
          {
            type: fullJob.actionType as any,
            config: fullJob.actionConfig as Record<string, unknown>,
          },
          {
            tenantId: fullJob.tenantId,
            subjectType: fullJob.subjectType,
            subjectId: fullJob.subjectId,
            record,
            tx,
          }
        );

        if (result.status === "succeeded") {
          await tx
            .update(workflowRuleScheduledJobs)
            .set({
              status: "completed",
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workflowRuleScheduledJobs.id, job.id),
                eq(workflowRuleScheduledJobs.tenantId, job.tenant_id)
              )
            );
          processed++;
        } else if (result.status === "skipped") {
          await tx
            .update(workflowRuleScheduledJobs)
            .set({
              status: "cancelled",
              lastError: result.error ?? result.detail ?? "Unknown error",
              cancelReason: result.detail ?? null,
              attempts: sql`attempts + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workflowRuleScheduledJobs.id, job.id),
                eq(workflowRuleScheduledJobs.tenantId, job.tenant_id)
              )
            );
          processed++;
        } else {
          await markScheduledJobForRetry(tx, job.id, result.error ?? result.detail ?? "Unknown error");
          failed++;
        }
      });
    } catch (err) {
      console.error(`[rules-scheduler] job ${job.id} failed:`, (err as Error).message);
      failed++;
      // Retry with a cap + exponential backoff. Without a cap, a job that
      // throws on every attempt (bad config, permanently-missing dependency)
      // resets straight back to 'pending' and re-fires every tick forever —
      // a poison loop that pins a worker and floods the logs. After
      // MAX_ATTEMPTS (5) we mark it terminally 'failed'; until then we push
      // run_at out by 2^attempts minutes so transient failures get breathing
      // room instead of hammering. SET expressions read the pre-update row,
      // so `attempts` here is the count BEFORE this failure.
      await withSystem(async (tx) => {
        await markScheduledJobForRetry(tx, job.id, (err as Error).message);
      });
    }
  }

  return { processed, failed };
}

async function markScheduledJobForRetry(tx: any, jobId: string, error: string) {
  await tx
    .update(workflowRuleScheduledJobs)
    .set({
      status: sql`CASE WHEN attempts + 1 >= 5 THEN 'failed'::text ELSE 'pending'::text END` as any,
      lastError: error,
      attempts: sql`attempts + 1`,
      runAt: sql`now() + (interval '1 minute' * power(2, LEAST(attempts, 6)))` as any,
      updatedAt: new Date(),
    })
    .where(eq(workflowRuleScheduledJobs.id, jobId));
}

function subjectTypeToModule(subjectType: string): string | undefined {
  const map: Record<string, string> = {
    investor: "investors",
    lead: "leads",
    task: "tasks",
    family: "families",
    transaction: "transactions",
    sip: "sips",
    sip_rejection: "sip_rejections",
    service_request: "service_requests",
    complaint: "complaints",
    review_meeting: "review_meetings",
    proposal: "proposals",
    insurance_policy: "insurance",
    content_post: "content_posts",
    campaign: "campaigns",
    goal: "goals",
    onboarding: "onboarding",
    risk_profile: "risk_profiles",
  };
  return map[subjectType];
}

export function startWorkflowRulesSchedulerWorker() {
  const interval = Number(process.env.WORKFLOW_RULES_SCHEDULER_INTERVAL_MS ?? 5000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { processed, failed } = await fireDueScheduledRuleJobs();
      if (processed > 0 || failed > 0) {
        console.log(`[rules-scheduler] processed=${processed} failed=${failed}`);
      }
    } catch (err) {
      console.error("[rules-scheduler] tick error:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  console.log(`[rules-scheduler] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
