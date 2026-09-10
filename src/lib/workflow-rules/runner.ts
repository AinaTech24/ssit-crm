/**
 * Rule runner — the core engine that turns events into actions.
 *
 * For an incoming event (from events_outbox or a manual test):
 *   1. Find matching rules for (module, triggerType)
 *   2. For record_action triggers: check `when` matches event kind, check
 *      `fields[]` (if specified) actually changed.
 *      For score_change triggers: check the score field moved in the rule's
 *      direction (and crossed the threshold, when one is set).
 *   3. Resolve the condition branch — Zoho-style: the main criteria is
 *      branch #1; extra `branches` are evaluated top-down, FIRST match wins.
 *   4. Execute the branch's instantActions via the action handler
 *   5. Queue the branch's scheduledActions into workflow_rule_scheduled_jobs
 *   6. Write a workflow_rule_executions row for the audit log
 *
 * Time-based rules (date_field / recurrence) reuse the same core via
 * `fireRuleOnRecordTx` — called by src/workers/workflow-rules-time-scanner.ts
 * with a synthetic idempotency eventId, so a re-scan can never double-fire.
 */

import { withTenant } from "@/db/client";
import { workflowRules, workflowRuleExecutions, workflowRuleScheduledJobs } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getModule, type ModuleKey } from "./modules";
import { evaluateCriteria, operatorMatches, readRecordField } from "./criteria";
import { executeAction, type ActionResult } from "./actions";
import type { CriteriaRow, Action, ScheduledAction } from "./types";

export interface RuleEvent {
  tenantId: string;
  module: ModuleKey;
  /** Matches Zoho's "Execute Based on Record Action" semantics. */
  recordAction: "create" | "edit" | "delete" | "field_update";
  subjectType: string;
  subjectId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  eventId?: string;
}

export interface RunResult {
  ruleId: string;
  matched: boolean;
  reason?: string;
  /** Which condition branch fired (0 = the rule's main criteria). */
  branchIndex?: number;
  branchName?: string;
  instantOutcomes: ActionResult[];
  scheduledQueued: number;
}

/** One resolved condition set — the main criteria (idx 0) or an extra branch. */
export interface EffectiveBranch {
  idx: number;
  name?: string;
  criteriaPattern?: string | null;
  criteriaRows: CriteriaRow[];
  instantActions: Action[];
  scheduledActions: ScheduledAction[];
}

/** Branch idx → scheduled-job actionIndex namespace (so per-branch reschedule
 *  lookups stay unique: branch 0 uses 0..99, branch 1 uses 100..199, …). */
const BRANCH_INDEX_STRIDE = 100;

export function effectiveBranches(rule: any): EffectiveBranch[] {
  const main: EffectiveBranch = {
    idx: 0,
    name: undefined,
    criteriaPattern: rule.criteriaPattern ?? null,
    criteriaRows: (rule.criteriaRows ?? []) as CriteriaRow[],
    instantActions: (rule.instantActions ?? []) as Action[],
    scheduledActions: (rule.scheduledActions ?? []) as ScheduledAction[],
  };
  const extra = ((rule.branches ?? []) as any[]).map((b, i) => ({
    idx: i + 1,
    name: typeof b?.name === "string" ? b.name : undefined,
    criteriaPattern: b?.criteriaPattern ?? null,
    criteriaRows: (b?.criteriaRows ?? []) as CriteriaRow[],
    instantActions: (b?.instantActions ?? []) as Action[],
    scheduledActions: (b?.scheduledActions ?? []) as ScheduledAction[],
  }));
  return [main, ...extra];
}

/** First branch (top-down) whose criteria match the record — Zoho semantics. */
export function resolveBranch(rule: any, record: Record<string, unknown>): EffectiveBranch | null {
  for (const b of effectiveBranches(rule)) {
    if (evaluateCriteria(b.criteriaRows, b.criteriaPattern, record)) return b;
  }
  return null;
}

/**
 * Public entry-point — call this from the outbox poller or any API that
 * mutates a domain record.
 */
export async function runRulesForEvent(event: RuleEvent): Promise<RunResult[]> {
  const mod = getModule(event.module);
  if (!mod) return [];

  return withTenant(event.tenantId, async (tx) => {
    // record_action rules + score_change rules (the latter piggyback on edit
    // events, comparing the score field's before/after values).
    const rules = await tx
      .select()
      .from(workflowRules)
      .where(
        and(
          eq(workflowRules.module, event.module as any),
          inArray(workflowRules.triggerType, ["record_action", "score_change"]),
          eq(workflowRules.enabled, true)
        )
      )
      .orderBy(workflowRules.executionOrder);

    const results: RunResult[] = [];
    for (const rule of rules) {
      const result = await runOneRule(tx, rule as any, event);
      results.push(result);
    }
    return results;
  });
}

async function runOneRule(tx: any, rule: any, event: RuleEvent): Promise<RunResult> {
  // ── Trigger gating (per trigger type) ──────────────────────────────────
  if (rule.triggerType === "score_change") {
    if (event.recordAction !== "edit") {
      return { ruleId: rule.id, matched: false, reason: "score rules fire on edits", instantOutcomes: [], scheduledQueued: 0 };
    }
    if (!scoreChangeMatches(rule, event.before, event.after)) {
      return { ruleId: rule.id, matched: false, reason: "score did not move/cross as configured", instantOutcomes: [], scheduledQueued: 0 };
    }
  } else {
    // record_action
    const cfg = (rule.triggerConfig ?? {}) as {
      when?: string;
      fields?: string[];
      fieldConditions?: Array<{ field: string; operator?: string; value?: unknown }>;
    };
    const when = cfg.when ?? "create_or_edit";

    // Step 1 — does the event's recordAction match the rule's `when`?
    const matchedAction =
      when === "create_or_edit"
        ? event.recordAction === "create" || event.recordAction === "edit"
        : when === "field_update"
          ? event.recordAction === "edit"
          : when === event.recordAction;
    if (!matchedAction) {
      return { ruleId: rule.id, matched: false, reason: "trigger.when mismatch", instantOutcomes: [], scheduledQueued: 0 };
    }

    // Step 2 — for edits, honour the field-level trigger config.
    if (when === "edit" || when === "field_update") {
      const changedFields = diffChangedFields(event.before, event.after);
      const after = (event.after ?? {}) as Record<string, unknown>;
      // Tolerant membership: a field "changed" if its key OR its camelCase
      // variant is in the diff (catalog keys may be snake_case).
      const didChange = (key: string) => {
        if (changedFields.includes(key)) return true;
        const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        return changedFields.includes(camel);
      };

      if (cfg.fieldConditions && cfg.fieldConditions.length > 0) {
        // Zoho "When [field] is modified to [operator][value]" — ALL rows must hold.
        const allOk = cfg.fieldConditions.every((c) => {
          if (!didChange(c.field)) return false;
          return operatorMatches(c.operator ?? "any", readRecordField(after, c.field), c.value);
        });
        if (!allOk) {
          return { ruleId: rule.id, matched: false, reason: "field condition not met", instantOutcomes: [], scheduledQueued: 0 };
        }
      } else if ((cfg.fields?.length ?? 0) > 0) {
        // Legacy: any of the watched fields changed.
        if (!cfg.fields!.some((f) => didChange(f))) {
          return { ruleId: rule.id, matched: false, reason: "no watched field changed", instantOutcomes: [], scheduledQueued: 0 };
        }
      }
    }
  }

  const record = (event.after ?? event.before ?? {}) as Record<string, unknown>;
  return applyRule(tx, rule, {
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    record,
    before: event.before,
    recordAction: event.recordAction,
    eventId: event.eventId ?? null,
    triggeredBy: "event",
  });
}

// ---------------------------------------------------------------------------
// Core: branch resolution → idempotency claim → actions → audit log.
// Shared by the event path above and the time scanner (date/recurrence rules).
// ---------------------------------------------------------------------------

export interface ApplyRuleContext {
  subjectType: string;
  subjectId: string;
  record: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  recordAction?: "create" | "edit" | "delete" | "field_update";
  /** Idempotency key, unique per (rule, firing): the outbox event id, or a
   *  synthetic key like "date:<subjectId>:<yyyy-mm-dd>" from the time scanner. */
  eventId?: string | null;
  triggeredBy: "event" | "schedule" | "manual" | "test";
}

/** Fire one rule against one record inside an existing tenant transaction. */
export async function fireRuleOnRecordTx(tx: any, rule: any, ctx: ApplyRuleContext): Promise<RunResult> {
  return applyRule(tx, rule, ctx);
}

async function applyRule(tx: any, rule: any, ctx: ApplyRuleContext): Promise<RunResult> {
  const record = ctx.record;

  // Step 3 — resolve the condition branch (first match wins)
  const branch = resolveBranch(rule, record);
  if (!branch) {
    if (ctx.recordAction === "edit") {
      await cancelScheduledJobsForSubjectAndRule(
        tx,
        rule.tenantId,
        rule.id,
        ctx.subjectType,
        ctx.subjectId,
        "Record no longer matches criteria"
      );
    }
    return { ruleId: rule.id, matched: false, reason: "criteria not met", instantOutcomes: [], scheduledQueued: 0 };
  }

  // Step 3.4 — branch switch on edit: cancel jobs queued by OTHER branches
  // (the record now falls into a different condition, so the old branch's
  // pending follow-ups no longer apply — Zoho cancels these too).
  let branchBefore: EffectiveBranch | null = null;
  if (ctx.recordAction === "edit" && ctx.before) {
    branchBefore = resolveBranch(rule, ctx.before as Record<string, unknown>);
    if (branchBefore && branchBefore.idx !== branch.idx) {
      await tx
        .update(workflowRuleScheduledJobs)
        .set({ status: "cancelled", cancelReason: "Record moved to a different condition branch", updatedAt: new Date() })
        .where(
          and(
            eq(workflowRuleScheduledJobs.tenantId, rule.tenantId),
            eq(workflowRuleScheduledJobs.ruleId, rule.id),
            eq(workflowRuleScheduledJobs.subjectType, ctx.subjectType),
            eq(workflowRuleScheduledJobs.subjectId, ctx.subjectId),
            eq(workflowRuleScheduledJobs.status, "pending"),
            sql`(action_index < ${branch.idx * BRANCH_INDEX_STRIDE} OR action_index >= ${(branch.idx + 1) * BRANCH_INDEX_STRIDE})`
          )
        );
    }
  }

  // Step 3.5 — repeat check (Zoho: Execute only once when criteria is first met).
  // Only meaningful for record_action edits where we know the before state.
  const repeat = ((rule.triggerConfig ?? {}) as { repeat?: boolean }).repeat ?? false;
  if (
    rule.triggerType === "record_action" &&
    !repeat &&
    ctx.recordAction === "edit" &&
    ctx.before &&
    branchBefore &&
    branchBefore.idx === branch.idx
  ) {
    return {
      ruleId: rule.id,
      matched: false,
      reason: "criteria already met in before state and repeat=false",
      instantOutcomes: [],
      scheduledQueued: 0,
    };
  }

  // Step 3.6 — idempotency claim.
  // Insert the execution row UP-FRONT keyed on (rule_id, trigger_event_id).
  // The partial unique index (migration 0058) makes a re-delivery of the same
  // event — or a re-scan of the same date tick — a no-op insert, so instant
  // actions (external sends) never fire twice for one logical trigger.
  let executionId: string | null = null;
  if (ctx.eventId) {
    const claimed = await tx
      .insert(workflowRuleExecutions)
      .values({
        tenantId: rule.tenantId,
        ruleId: rule.id,
        triggeredBy: ctx.triggeredBy,
        triggerEventId: ctx.eventId,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        contextSnapshot: record,
        instantOutcomes: [],
        scheduledQueued: 0,
        status: "succeeded",
      })
      .onConflictDoNothing({
        // NB: onConflictDoNothing uses `where` for the partial-index predicate
        // (only onConflictDoUpdate has `targetWhere`). It must textually cover
        // the index predicate so Postgres can infer wre_rule_event_unique.
        target: [workflowRuleExecutions.ruleId, workflowRuleExecutions.triggerEventId],
        where: sql`trigger_event_id IS NOT NULL`,
      })
      .returning({ id: workflowRuleExecutions.id });
    if (claimed.length === 0) {
      // This (rule, event) pair was already processed — idempotent skip.
      return {
        ruleId: rule.id,
        matched: false,
        reason: "already processed (idempotent skip)",
        instantOutcomes: [],
        scheduledQueued: 0,
      };
    }
    executionId = claimed[0].id;
  }

  // Step 3.7 — rate cap. A pathological high-frequency rule (or a misconfigured
  // recurrence) could fire a comms storm and burn the per-tenant message quota.
  // If this rule already fired `rateLimitPerHour` times in the trailing hour,
  // skip the actions (the claimed row is marked 'skipped'). Manual/test runs
  // (no executionId) are exempt.
  const cap = (rule as any).rateLimitPerHour as number | null | undefined;
  if (cap && cap > 0 && executionId) {
    const recent = (await tx.execute(sql`
      SELECT count(*)::int c FROM workflow_rule_executions
      WHERE rule_id = ${rule.id}::uuid
        AND executed_at > now() - interval '1 hour'
        AND id <> ${executionId}::uuid
    `)).rows[0] as { c?: number } | undefined;
    if (Number(recent?.c ?? 0) >= cap) {
      await tx
        .update(workflowRuleExecutions)
        .set({ status: "skipped", error: `Rate limit reached: ${cap}/hour` })
        .where(eq(workflowRuleExecutions.id, executionId));
      return {
        ruleId: rule.id,
        matched: false,
        reason: `rate_limited (${cap}/hour)`,
        instantOutcomes: [],
        scheduledQueued: 0,
      };
    }
  }

  // Step 4 — execute the branch's instant actions
  const instantOutcomes: ActionResult[] = [];
  for (const action of branch.instantActions) {
    try {
      const out = await executeAction(action, {
        tenantId: rule.tenantId,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        record,
        tx,
        ruleCreatedBy: rule.createdBy ?? null,
      });
      instantOutcomes.push(out);
    } catch (e: any) {
      instantOutcomes.push({
        type: action.type,
        status: "failed",
        error: e?.message ?? String(e),
      });
    }
  }

  // Step 5 — queue the branch's scheduled actions
  let scheduledQueued = 0;
  for (let i = 0; i < branch.scheduledActions.length; i++) {
    const sa = branch.scheduledActions[i];
    const runAt = computeRunAt(sa, record);
    if (!runAt) continue;
    const actionIndex = branch.idx * BRANCH_INDEX_STRIDE + i;

    // Reschedule existing pending job if it exists
    const existing = await tx
      .select()
      .from(workflowRuleScheduledJobs)
      .where(
        and(
          eq(workflowRuleScheduledJobs.tenantId, rule.tenantId),
          eq(workflowRuleScheduledJobs.ruleId, rule.id),
          eq(workflowRuleScheduledJobs.subjectType, ctx.subjectType),
          eq(workflowRuleScheduledJobs.subjectId, ctx.subjectId),
          eq(workflowRuleScheduledJobs.actionIndex, actionIndex),
          eq(workflowRuleScheduledJobs.status, "pending")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(workflowRuleScheduledJobs)
        .set({
          runAt,
          actionConfig: sa.config,
          updatedAt: new Date(),
        })
        .where(eq(workflowRuleScheduledJobs.id, existing[0].id));
    } else {
      await tx.insert(workflowRuleScheduledJobs).values({
        tenantId: rule.tenantId,
        ruleId: rule.id,
        executionId,
        actionIndex,
        subjectType: ctx.subjectType,
        subjectId: ctx.subjectId,
        actionType: sa.type,
        actionConfig: sa.config,
        runAt,
      });
      scheduledQueued++;
    }
  }

  // Step 6 — write execution log + bump counters
  const status =
    instantOutcomes.length === 0
      ? "succeeded"
      : instantOutcomes.every((o) => o.status === "succeeded")
        ? "succeeded"
        : instantOutcomes.every((o) => o.status === "failed")
          ? "failed"
          : "partial";

  if (executionId) {
    // Finalize the row we claimed in step 3.6 with the real outcomes.
    await tx
      .update(workflowRuleExecutions)
      .set({ instantOutcomes, scheduledQueued, status })
      .where(eq(workflowRuleExecutions.id, executionId));
  } else {
    // Manual / test trigger (no eventId) — nothing to claim, just log.
    await tx.insert(workflowRuleExecutions).values({
      tenantId: rule.tenantId,
      ruleId: rule.id,
      triggeredBy: ctx.triggeredBy,
      triggerEventId: null,
      subjectType: ctx.subjectType,
      subjectId: ctx.subjectId,
      contextSnapshot: record,
      instantOutcomes,
      scheduledQueued,
      status,
    });
  }

  await tx
    .update(workflowRules)
    .set({
      executionCount: sql`${workflowRules.executionCount} + 1`,
      lastExecutedAt: new Date(),
    })
    .where(eq(workflowRules.id, rule.id));

  return {
    ruleId: rule.id,
    matched: true,
    branchIndex: branch.idx,
    branchName: branch.name,
    instantOutcomes,
    scheduledQueued,
  };
}

// ---------------------------------------------------------------------------
// Score-change gating
// ---------------------------------------------------------------------------

/**
 * Did the score field move per the rule's config?
 *   direction increase/decrease — value moved that way;
 *   with a threshold — fire only when the value CROSSES the threshold
 *   (before < t ≤ after going up; before ≥ t > after going down), so a score
 *   hovering above the line doesn't re-fire on every +1.
 */
function scoreChangeMatches(
  rule: any,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): boolean {
  const cfg = (rule.triggerConfig ?? {}) as { field?: string; direction?: string; threshold?: number };
  const field = String(cfg.field ?? "");
  if (!field) return false;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const b = num(before?.[field]);
  const a = num(after?.[field]);
  if (a === null || b === null || a === b) return false;

  const direction = cfg.direction ?? "updated";
  if (direction === "increase" && a <= b) return false;
  if (direction === "decrease" && a >= b) return false;

  const t = num(cfg.threshold);
  if (t !== null) {
    const crossedUp = b < t && a >= t;
    const crossedDown = b >= t && a < t;
    if (direction === "increase") return crossedUp;
    if (direction === "decrease") return crossedDown;
    return crossedUp || crossedDown;
  }
  return true;
}

function diffChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  if (!before || !after) return [];
  const changed: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = (before as any)[k];
    const a = (after as any)[k];
    // Order-insensitive deep compare. JSON.stringify is key-order sensitive,
    // so two equal objects serialized in different orders would falsely read
    // as "changed" and fire watched-field rules spuriously.
    if (!deepEqual(b, a)) changed.push(k);
  }
  return changed;
}

/** Structural deep-equality that ignores object key order. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;

  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : new Date(a as any).getTime();
    const bt = b instanceof Date ? b.getTime() : new Date(b as any).getTime();
    return at === bt;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

function computeRunAt(sa: ScheduledAction, record: Record<string, unknown>): Date | null {
  const now = new Date();
  let anchor = now;

  if (sa.delay.anchor === "date_field" && sa.delay.anchorField) {
    const v = record[sa.delay.anchorField] ?? record[sa.delay.anchorField.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
    if (!v) return null;
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return null;
    anchor = d;
  }

  const ms = unitToMs(sa.delay.unit) * sa.delay.amount;
  return new Date(anchor.getTime() + ms);
}

function unitToMs(unit: "minute" | "hour" | "day" | "week"): number {
  switch (unit) {
    case "minute":
      return 60 * 1000;
    case "hour":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Cancellation hook — call when a record is deleted to clean up pending jobs.
 */
export async function cancelScheduledJobsForSubject(
  tenantId: string,
  subjectType: string,
  subjectId: string,
  reason = "Subject deleted"
) {
  return withTenant(tenantId, async (tx) => {
    await tx
      .update(workflowRuleScheduledJobs)
      .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(workflowRuleScheduledJobs.tenantId, tenantId),
          eq(workflowRuleScheduledJobs.subjectType, subjectType),
          eq(workflowRuleScheduledJobs.subjectId, subjectId),
          eq(workflowRuleScheduledJobs.status, "pending")
        )
      );
  });
}

/**
 * Cancellation hook — cancel pending jobs for a specific rule and record.
 */
export async function cancelScheduledJobsForSubjectAndRule(
  tx: any,
  tenantId: string,
  ruleId: string,
  subjectType: string,
  subjectId: string,
  reason = "Criteria no longer met"
) {
  await tx
    .update(workflowRuleScheduledJobs)
    .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(workflowRuleScheduledJobs.tenantId, tenantId),
        eq(workflowRuleScheduledJobs.ruleId, ruleId),
        eq(workflowRuleScheduledJobs.subjectType, subjectType),
        eq(workflowRuleScheduledJobs.subjectId, subjectId),
        eq(workflowRuleScheduledJobs.status, "pending")
      )
    );
}
