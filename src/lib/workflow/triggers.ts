/**
 * Trigger materialization — the bridge between a workflow's graph and the
 * `workflow_triggers` rows the outbox poller + master scheduler actually read.
 *
 * A workflow's graph has exactly one trigger node whose `config.kind` declares
 * HOW it fires:
 *   • "schedule"            → a cron trigger (config.cron, optional timezone)
 *   • a dotted event name   → a record_event subscription (e.g. "goal.drift",
 *     ("x.y" / "x.y.z")       "investor.birthday", "investor.risk_profile_expired")
 *   • "segment_entry" /     → segment / channel triggers (passed through)
 *     "segment_exit" /
 *     "inbound_message" /
 *     "communication_event" /
 *     "webhook"
 *   • "manual" or empty     → a manual trigger (no auto-fire)
 *
 * Until now nothing wrote these rows, so published workflows never fired on
 * events or schedules. publish() + the enable/disable toggle now call in here.
 *
 * Idempotent: materializing replaces the workflow's existing trigger rows, so
 * republishing a changed graph re-derives them cleanly.
 */

import { CronExpressionParser } from "cron-parser";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { workflowTriggers } from "@/db/schema";

const DEFAULT_TZ = "Asia/Kolkata";
const PASSTHROUGH_KINDS = new Set([
  "segment_entry",
  "segment_exit",
  "inbound_message",
  "communication_event",
  "webhook",
]);

interface TriggerNodeConfig {
  kind?: string;
  cron?: string;
  timezone?: string;
  /** Optional pre-filter AST applied to the event payload at trigger time. */
  criteria?: unknown;
  /** Subject type the actions resolve against (defaults to the event's entity). */
  subjectType?: string;
  /** Optional prefix subscriptions, e.g. ["lead.stage."]. */
  eventPrefixes?: string[];
}

function nextCron(cron: string | undefined, tz: string): Date | null {
  if (!cron) return null;
  try {
    return CronExpressionParser.parse(cron, { tz }).next().toDate();
  } catch {
    return null;
  }
}

/**
 * Derive + persist the `workflow_triggers` row(s) for a workflow from its
 * (published) graph. Removes any prior trigger rows first. `enabled` mirrors
 * the workflow's enabled flag so a disabled workflow never fires.
 *
 * Returns the materialized trigger kind (for logging/asserting).
 */
export type DerivedTrigger = {
  kind: string;
  config: Record<string, unknown>;
  criteria: unknown;
  cronExpression: string | null;
  nextRunAt: Date | null;
};

/**
 * Pure derivation of a workflow's trigger row from its graph. Split out of
 * materializeTriggers so a caller that must not delete the existing row —
 * workflow_runs.trigger_id references it, so a delete fails once the workflow
 * has ever run — can update it in place instead.
 */
export function deriveTrigger(graph: any): DerivedTrigger {
  const triggerNode = (graph?.nodes ?? []).find((n: any) => n?.type === "trigger");
  const cfg: TriggerNodeConfig = (triggerNode?.config ?? {}) as TriggerNodeConfig;
  const kind = (cfg.kind ?? "").trim();

  let rowKind: string;
  let config: Record<string, unknown>;
  let criteria: unknown = cfg.criteria ?? null;
  let cronExpression: string | null = null;
  let nextRunAt: Date | null = null;

  if (kind === "schedule") {
    const tz = cfg.timezone ?? DEFAULT_TZ;
    rowKind = "schedule";
    config = { cron: cfg.cron ?? null, timezone: tz };
    cronExpression = cfg.cron ?? null;
    nextRunAt = nextCron(cfg.cron, tz);
    criteria = null; // schedules don't pre-filter an event payload
  } else if (kind === "" || kind === "manual") {
    rowKind = "manual";
    config = {};
    criteria = null;
  } else if (PASSTHROUGH_KINDS.has(kind)) {
    rowKind = kind;
    config = { eventKind: kind, subjectType: cfg.subjectType ?? "investor" };
  } else {
    // A dotted domain event ("goal.drift", "investor.birthday", …).
    rowKind = "record_event";
    config = {
      eventKind: kind,
      subjectType: cfg.subjectType ?? "investor",
      ...(cfg.eventPrefixes ? { eventPrefixes: cfg.eventPrefixes } : {}),
    };
  }

  return { kind: rowKind, config, criteria, cronExpression, nextRunAt };
}

export async function materializeTriggers(
  tx: Tx,
  opts: { tenantId: string; workflowId: string; graph: any; enabled: boolean }
): Promise<string> {
  const { tenantId, workflowId, graph, enabled } = opts;
  const d = deriveTrigger(graph);

  // Republish replaces — a changed trigger node must not leave a stale row.
  await tx.delete(workflowTriggers).where(and(eq(workflowTriggers.workflowId, workflowId), eq(workflowTriggers.tenantId, tenantId)));

  await tx.insert(workflowTriggers).values({
    workflowId,
    tenantId,
    kind: d.kind as any,
    config: d.config as any,
    criteria: d.criteria as any,
    enabled,
    cronExpression: d.cronExpression,
    nextRunAt: d.nextRunAt,
  } as any);

  return d.kind;
}

/**
 * Bring a workflow's trigger row in line with its graph WITHOUT deleting it.
 * Inserts when none exists, updates in place when one does — safe on a
 * workflow that already has runs pointing at the trigger.
 */
export async function upsertTrigger(
  tx: Tx,
  opts: { tenantId: string; workflowId: string; graph: any; enabled: boolean }
): Promise<string> {
  const { tenantId, workflowId, graph, enabled } = opts;
  const d = deriveTrigger(graph);
  const scope = and(eq(workflowTriggers.workflowId, workflowId), eq(workflowTriggers.tenantId, tenantId));
  const existing = await tx.select({ id: workflowTriggers.id }).from(workflowTriggers).where(scope).limit(1);

  if (existing.length === 0) {
    await tx.insert(workflowTriggers).values({
      workflowId,
      tenantId,
      kind: d.kind as any,
      config: d.config as any,
      criteria: d.criteria as any,
      enabled,
      cronExpression: d.cronExpression,
      nextRunAt: d.nextRunAt,
    } as any);
    return d.kind;
  }

  await tx
    .update(workflowTriggers)
    .set({
      kind: d.kind as any,
      config: d.config as any,
      criteria: d.criteria as any,
      enabled,
      cronExpression: d.cronExpression,
      nextRunAt: d.nextRunAt,
      updatedAt: new Date(),
    } as any)
    .where(scope);
  return d.kind;
}

/**
 * Flip the enabled flag on a workflow's triggers (the enable/disable toggle).
 * Re-enabling a schedule recomputes nextRunAt so it doesn't immediately fire
 * for a long-past slot.
 */
export async function setTriggersEnabled(tx: Tx, workflowId: string, enabled: boolean, tenantId?: string): Promise<void> {
  const whereClause = tenantId
    ? and(eq(workflowTriggers.workflowId, workflowId), eq(workflowTriggers.tenantId, tenantId))
    : eq(workflowTriggers.workflowId, workflowId);
  const rows = await tx.select().from(workflowTriggers).where(whereClause);
  for (const t of rows) {
    let nextRunAt = t.nextRunAt;
    if (enabled && t.kind === "schedule" && t.cronExpression) {
      nextRunAt = nextCron(t.cronExpression, DEFAULT_TZ) ?? t.nextRunAt;
    }
    const updateWhere = tenantId
      ? and(eq(workflowTriggers.id, t.id), eq(workflowTriggers.tenantId, tenantId))
      : eq(workflowTriggers.id, t.id);
    await tx
      .update(workflowTriggers)
      .set({ enabled, nextRunAt } as any)
      .where(updateWhere);
  }
}
