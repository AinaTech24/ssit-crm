/**
 * Automation Control Tower — the trust surface for the engine.
 *
 * An owner only leans on automation if they can see it working: what fired,
 * what's in-flight, what failed and why, whether the event spine (outbox) is
 * draining, and whether messages are actually being delivered. This lib
 * aggregates all of that for a time window.
 *
 * Read-only + tenant-scoped (RLS via withTenant). The page layers a
 * "re-queue failed run" action on top (POST /api/workflows/runs/[id]/retry).
 */

import { sql } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

/**
 * Who may see the Automation Monitor. `workflow.view` alone includes marketing
 * (they see the workflow list/segments), but the operational control tower —
 * run errors, run variables (PII), the event spine — is an ops/compliance
 * surface, matching the sidebar's role restriction on this link.
 */
export const MONITOR_ROLES = ["owner", "compliance", "back_office", "ops"] as const;

export function canViewMonitor(roles: string[], permissions?: unknown): boolean {
  return can(roles, "workflow.view", permissions as any) && roles.some((r) => (MONITOR_ROLES as readonly string[]).includes(r));
}

export type AutomationHealth = {
  windowDays: number;
  runs: {
    total: number;
    byStatus: Record<string, number>;
    failed: number;
    inFlight: number; // running + paused, current (not windowed)
    failureRatePct: number;
  };
  recentFailedRuns: Array<{
    id: string;
    workflowName: string;
    subjectType: string | null;
    error: string | null;
    at: string | null;
  }>;
  outbox: {
    pending: number;
    stuck: number; // unprocessed AND older than 1h
    recentErrors: Array<{ id: string; kind: string; attempts: number; lastError: string; at: string }>;
  };
  comms: {
    delivered: number;
    queued: number;
    skipped: number;
    failed: number;
    recentFailed: Array<{ id: string; channel: string; reason: string | null; at: string | null }>;
  };
  /** Workflow Rules engine (the Zoho-style rules) — the primary automation
   *  surface for most tenants, separate from the advanced workflow_runs engine. */
  rules: {
    total: number;
    byStatus: Record<string, number>; // succeeded | partial | failed | skipped
    failed: number; // failed + partial — anything that didn't fully succeed
    recentFailed: Array<{
      id: string;
      ruleId: string;
      ruleName: string;
      status: string;
      reason: string | null;
      subjectType: string | null;
      at: string | null;
    }>;
  };
  /** Scheduled rule actions waiting to fire (or that failed/are stuck). */
  scheduledJobs: {
    pending: number;
    running: number;
    failed: number;
    cancelled: number;
    overdue: number; // pending but run_at is >1h in the past (poller wedged)
    recentFailed: Array<{ id: string; actionType: string; lastError: string | null; attempts: number; at: string | null }>;
  };
  impact: {
    messagesSent: number;
    runsCompleted: number;
    rulesFired: number;
  };
};

export async function getAutomationHealth(
  tx: Tx,
  tenantId: string,
  windowDays = 7
): Promise<AutomationHealth> {
  const win = sql.raw(`${Math.max(1, Math.min(90, Math.floor(windowDays)))} days`);

  // ── Workflow runs by status (windowed) ───────────────────────────────
  const runStatus = await tx.execute(sql`
    SELECT status, count(*)::int AS c
    FROM workflow_runs
    WHERE tenant_id = ${tenantId}::uuid
      AND created_at >= now() - interval '${win}'
    GROUP BY status
  `);
  const byStatus: Record<string, number> = {};
  for (const r of runStatus.rows as any[]) byStatus[r.status] = Number(r.c);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const failed = byStatus["failed"] ?? 0;

  // In-flight is *current* state (not windowed) — what's live right now.
  const inFlightRow = await tx.execute(sql`
    SELECT count(*)::int AS c
    FROM workflow_runs
    WHERE tenant_id = ${tenantId}::uuid
      AND status IN ('running','paused')
  `);
  const inFlight = Number((inFlightRow.rows[0] as any)?.c ?? 0);

  // ── Recent failed runs (with workflow name) ───────────────────────────
  const failedRuns = await tx.execute(sql`
    SELECT wr.id, COALESCE(w.name, 'Workflow') AS workflow_name,
           wr.subject_type, wr.error, wr.completed_at, wr.created_at
    FROM workflow_runs wr
    LEFT JOIN workflows w ON w.id = wr.workflow_id AND w.tenant_id = ${tenantId}::uuid
    WHERE wr.status = 'failed'
      AND wr.tenant_id = ${tenantId}::uuid
      AND wr.created_at >= now() - interval '${win}'
    ORDER BY COALESCE(wr.completed_at, wr.created_at) DESC
    LIMIT 8
  `);

  // ── Outbox health (event spine) ───────────────────────────────────────
  const outboxAgg = await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE processed_at IS NULL)::int AS pending,
      count(*) FILTER (WHERE processed_at IS NULL AND occurred_at < now() - interval '1 hour')::int AS stuck
    FROM events_outbox
    WHERE tenant_id = ${tenantId}::uuid
  `);
  const outboxErrors = await tx.execute(sql`
    SELECT id::text AS id, kind, COALESCE(attempts,0)::int AS attempts, last_error, occurred_at
    FROM events_outbox
    WHERE last_error IS NOT NULL AND processed_at IS NULL
      AND tenant_id = ${tenantId}::uuid
    ORDER BY occurred_at DESC
    LIMIT 5
  `);

  // ── Communications delivery (windowed) ────────────────────────────────
  const commsStatus = await tx.execute(sql`
    SELECT status, count(*)::int AS c
    FROM communications
    WHERE tenant_id = ${tenantId}::uuid
      AND created_at >= now() - interval '${win}'
      AND direction = 'outbound'
    GROUP BY status
  `);
  let delivered = 0, queued = 0, skipped = 0, commFailed = 0;
  for (const r of commsStatus.rows as any[]) {
    const s = r.status as string;
    const c = Number(r.c);
    if (s === "sent" || s === "delivered" || s === "read" || s === "replied") delivered += c;
    else if (s === "queued") queued += c;
    else if (s.startsWith("skipped_")) skipped += c;
    else if (s === "failed" || s === "bounced") commFailed += c;
  }
  const recentFailedComms = await tx.execute(sql`
    SELECT id, channel, status_reason, created_at
    FROM communications
    WHERE direction = 'outbound'
      AND status IN ('failed','bounced')
      AND tenant_id = ${tenantId}::uuid
      AND created_at >= now() - interval '${win}'
    ORDER BY created_at DESC
    LIMIT 8
  `);

  // ── Workflow Rules executions (windowed) ──────────────────────────────
  const ruleStatus = await tx.execute(sql`
    SELECT status, count(*)::int AS c
    FROM workflow_rule_executions
    WHERE tenant_id = ${tenantId}::uuid
      AND executed_at >= now() - interval '${win}'
    GROUP BY status
  `);
  const ruleByStatus: Record<string, number> = {};
  for (const r of ruleStatus.rows as any[]) ruleByStatus[r.status] = Number(r.c);
  const ruleTotal = Object.values(ruleByStatus).reduce((a, b) => a + b, 0);

  // Recent failed / partial rule executions, with a readable reason pulled from
  // the per-action instant_outcomes when the top-level error is null (partials).
  const recentFailedRules = await tx.execute(sql`
    SELECT e.id, e.rule_id, COALESCE(r.name, 'Rule') AS rule_name, e.status,
           e.subject_type, e.executed_at,
           COALESCE(
             e.error,
             (SELECT string_agg(
                        (elem->>'type') || ': ' || COALESCE(elem->>'error', elem->>'detail', 'failed'), '; ')
              FROM jsonb_array_elements(COALESCE(e.instant_outcomes, '[]'::jsonb)) elem
              WHERE elem->>'status' = 'failed')
           ) AS reason
    FROM workflow_rule_executions e
    LEFT JOIN workflow_rules r ON r.id = e.rule_id AND r.tenant_id = ${tenantId}::uuid
    WHERE e.tenant_id = ${tenantId}::uuid
      AND e.status IN ('failed','partial')
      AND e.executed_at >= now() - interval '${win}'
    ORDER BY e.executed_at DESC
    LIMIT 8
  `);

  // ── Scheduled rule jobs (current snapshot — operational state) ─────────
  const jobStatus = await tx.execute(sql`
    SELECT status, count(*)::int AS c,
           count(*) FILTER (WHERE status = 'pending' AND run_at < now() - interval '1 hour')::int AS overdue
    FROM workflow_rule_scheduled_jobs
    WHERE tenant_id = ${tenantId}::uuid
    GROUP BY status
  `);
  const jobByStatus: Record<string, number> = {};
  let jobsOverdue = 0;
  for (const r of jobStatus.rows as any[]) {
    jobByStatus[r.status] = Number(r.c);
    jobsOverdue += Number(r.overdue ?? 0);
  }
  const recentFailedJobs = await tx.execute(sql`
    SELECT id, action_type, last_error, COALESCE(attempts,0)::int AS attempts, updated_at
    FROM workflow_rule_scheduled_jobs
    WHERE tenant_id = ${tenantId}::uuid AND status = 'failed'
    ORDER BY updated_at DESC
    LIMIT 8
  `);

  return {
    windowDays,
    runs: {
      total,
      byStatus,
      failed,
      inFlight,
      failureRatePct: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
    },
    recentFailedRuns: (failedRuns.rows as any[]).map((r) => ({
      id: r.id,
      workflowName: r.workflow_name,
      subjectType: r.subject_type,
      error: r.error,
      at: r.completed_at ?? r.created_at,
    })),
    outbox: {
      pending: Number((outboxAgg.rows[0] as any)?.pending ?? 0),
      stuck: Number((outboxAgg.rows[0] as any)?.stuck ?? 0),
      recentErrors: (outboxErrors.rows as any[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        attempts: Number(r.attempts),
        lastError: r.last_error,
        at: r.occurred_at,
      })),
    },
    comms: {
      delivered,
      queued,
      skipped,
      failed: commFailed,
      recentFailed: (recentFailedComms.rows as any[]).map((r) => ({
        id: r.id,
        channel: r.channel,
        reason: r.status_reason,
        at: r.created_at,
      })),
    },
    rules: {
      total: ruleTotal,
      byStatus: ruleByStatus,
      failed: (ruleByStatus["failed"] ?? 0) + (ruleByStatus["partial"] ?? 0),
      recentFailed: (recentFailedRules.rows as any[]).map((r) => ({
        id: r.id,
        ruleId: r.rule_id,
        ruleName: r.rule_name,
        status: r.status,
        reason: r.reason,
        subjectType: r.subject_type,
        at: r.executed_at,
      })),
    },
    scheduledJobs: {
      pending: jobByStatus["pending"] ?? 0,
      running: jobByStatus["running"] ?? 0,
      failed: jobByStatus["failed"] ?? 0,
      cancelled: jobByStatus["cancelled"] ?? 0,
      overdue: jobsOverdue,
      recentFailed: (recentFailedJobs.rows as any[]).map((r) => ({
        id: r.id,
        actionType: r.action_type,
        lastError: r.last_error,
        attempts: Number(r.attempts),
        at: r.updated_at,
      })),
    },
    impact: {
      messagesSent: delivered,
      runsCompleted: byStatus["completed"] ?? 0,
      rulesFired: ruleByStatus["succeeded"] ?? 0,
    },
  };
}
