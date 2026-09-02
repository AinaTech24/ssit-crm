import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Zoho-CRM-style Workflow Rules.
 *
 * A simpler abstraction than the DAG-based `workflows` table — each rule is:
 *
 *     module + trigger + criteria + instant actions + scheduled actions
 *
 * Rules are matched against `events_outbox` rows by the rule runner.
 * Instant actions execute synchronously; scheduled actions are queued in
 * `workflow_rule_scheduled_jobs` with a `runAt` timestamp.
 *
 * The user-facing concept is "Workflow Rules"; the underlying graph engine
 * (`workflows`, `workflow_runs`, etc.) is still used for complex multi-step
 * automations, but Rules cover 95% of the Zoho-style configuration use cases.
 */
export const workflowRules = pgTable(
  "workflow_rules",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** The module this rule applies to. Determines available fields, triggers,
     *  and where the rule shows up in the UI. */
    module: text("module", {
      enum: [
        "leads",
        "investors",
        "families",
        "tasks",
        "transactions",
        "sips",
        "sip_rejections",
        "service_requests",
        "complaints",
        "review_meetings",
        "proposals",
        "insurance",
        "content_posts",
        "campaigns",
        "goals",
        "onboarding",
        "risk_profiles",
      ],
    }).notNull(),

    name: text("name").notNull(),
    description: text("description"),

    /** Trigger type — Zoho's "Execute Based on Record Action" / "Date Field" / etc. */
    triggerType: text("trigger_type", {
      enum: [
        "record_action",   // create / edit / create_or_edit / delete
        "date_field",      // run on/before/after a date field
        "score_change",    // record score increase / decrease / update
        "note",            // note added / modified / deleted
        "recommendation",  // before / on / after recommendation date
        "competitor",      // competitor mention (Zia)
        "recurrence",      // periodic time-based
      ],
    }).notNull(),

    /** Per-kind config — see /lib/workflow-rules/triggers/<kind>.ts for schemas. */
    triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull(),

    /** Pattern string like "1 AND (2 OR 3)" referring to criteriaRows by 1-based index.
     *  Null means "any record matches" (Zoho's "All records"). */
    criteriaPattern: text("criteria_pattern"),

    /** Array of criteria rows: [{ field, operator, value }, ...]. Ordered 1..N. */
    criteriaRows: jsonb("criteria_rows")
      .$type<Array<{ field: string; operator: string; value: unknown }>>()
      .default(sql`'[]'::jsonb`),

    /** Instant actions — fire immediately on rule match.
     *  Each action: { type: 'send_email'|'create_task'|'update_field'|'webhook'|..., config: {...} } */
    instantActions: jsonb("instant_actions")
      .$type<Array<{ type: string; config: Record<string, unknown> }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Scheduled actions — fire after a configurable delay relative to trigger.
     *  Each: { delay: {amount, unit, anchor}, type, config } */
    scheduledActions: jsonb("scheduled_actions")
      .$type<
        Array<{
          delay: { amount: number; unit: "minute" | "hour" | "day" | "week"; anchor?: "trigger" | "date_field" };
          type: string;
          config: Record<string, unknown>;
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Condition branches (Zoho: up to 10 conditions per rule, each with its own
     *  actions; a record falls into the FIRST branch whose criteria match).
     *  Empty array = the legacy single criteriaRows/instantActions columns apply. */
    branches: jsonb("branches")
      .$type<
        Array<{
          name?: string;
          criteriaPattern?: string | null;
          criteriaRows?: Array<{ field: string; operator: string; value: unknown }>;
          instantActions?: Array<{ type: string; config: Record<string, unknown> }>;
          scheduledActions?: Array<{
            delay: { amount: number; unit: "minute" | "hour" | "day" | "week"; anchor?: "trigger" | "date_field"; anchorField?: string };
            type: string;
            config: Record<string, unknown>;
          }>;
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Active / inactive toggle. Zoho shows this on the rule list. */
    enabled: boolean("enabled").notNull().default(true),

    /** Lock — Zoho lets admins lock rules so other users cannot edit them. */
    locked: boolean("locked").notNull().default(false),
    lockReason: text("lock_reason"),
    lockedBy: uuid("locked_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    /** Execution order within the module. Lower runs first when multiple rules match. */
    executionOrder: integer("execution_order").notNull().default(100),

    /** Safety throttle — max event-triggered firings per trailing hour. NULL =
     *  unlimited. Protects against a pathological high-frequency rule (and the
     *  per-tenant message quota) firing a comms storm. Manual/test runs exempt. */
    rateLimitPerHour: integer("rate_limit_per_hour"),

    /** Counters for the Usage tab. */
    executionCount: integer("execution_count").notNull().default(0),
    lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    moduleIdx: index("wr_module_idx").on(t.tenantId, t.module, t.enabled),
    triggerIdx: index("wr_trigger_idx").on(t.module, t.triggerType, t.enabled),
    orderIdx: index("wr_order_idx").on(t.tenantId, t.module, t.executionOrder),
    nameUnique: uniqueIndex("wr_tenant_name_unique").on(t.tenantId, t.module, t.name),
  })
);

/**
 * Audit log of rule executions — one row per rule match.
 * Powers the "Usage" tab on each rule (open rate, success rate, etc.).
 */
export const workflowRuleExecutions = pgTable(
  "workflow_rule_executions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => workflowRules.id, { onDelete: "cascade" }),

    /** What triggered this — outbox event id, manual trigger, schedule tick, etc. */
    triggeredBy: text("triggered_by", {
      enum: ["event", "manual", "schedule", "test"],
    }).notNull(),
    triggerEventId: text("trigger_event_id"),

    /** Subject record — usually an investor / lead / task / etc. */
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),

    /** Snapshot of the subject at trigger time. */
    contextSnapshot: jsonb("context_snapshot"),

    /** Per-action outcomes: [{ type, status, error?, externalId? }, ...] */
    instantOutcomes: jsonb("instant_outcomes").default(sql`'[]'::jsonb`),

    /** How many scheduled jobs were queued (rows in workflow_rule_scheduled_jobs). */
    scheduledQueued: integer("scheduled_queued").notNull().default(0),

    status: text("status", {
      enum: ["succeeded", "partial", "failed", "skipped"],
    })
      .notNull()
      .default("succeeded"),

    error: text("error"),
    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ruleIdx: index("wre_rule_idx").on(t.ruleId, t.executedAt),
    subjectIdx: index("wre_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
    // Monitor: per-tenant execution-status rollup + recent failures by time.
    tenantStatusIdx: index("wre_tenant_status_idx").on(t.tenantId, t.status, t.executedAt),
    // Idempotency: one execution row per (rule, outbox event). The runner
    // claims this up-front with ON CONFLICT DO NOTHING so a re-delivered event
    // never fires instant actions (external sends) twice. Partial — manual /
    // test executions have a NULL trigger_event_id and are exempt.
    eventUnique: uniqueIndex("wre_rule_event_unique")
      .on(t.ruleId, t.triggerEventId)
      .where(sql`trigger_event_id IS NOT NULL`),
  })
);

/**
 * Queue of scheduled actions waiting to fire. The master scheduler worker picks
 * these up when `runAt <= now()` and dispatches them.
 *
 * Zoho's behavior:
 *   - If the source record is re-edited and still matches criteria, the
 *     scheduled job is re-scheduled (we update `runAt`).
 *   - If the source record is edited and no longer matches, the job is
 *     cancelled (we set status='cancelled').
 *   - If the source record is deleted, all pending jobs are cancelled.
 */
export const workflowRuleScheduledJobs = pgTable(
  "workflow_rule_scheduled_jobs",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => workflowRules.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id").references(() => workflowRuleExecutions.id),

    /** Index of the scheduledAction within the rule's scheduledActions array. */
    actionIndex: integer("action_index").notNull(),

    /** Subject record this action will run against. */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),

    /** Snapshot of the action config at queue time (so later rule edits don't
     *  change what's already scheduled). */
    actionType: text("action_type").notNull(),
    actionConfig: jsonb("action_config").notNull(),

    runAt: timestamp("run_at", { withTimezone: true }).notNull(),

    status: text("status", {
      enum: ["pending", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),

    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),

    ...timestamps,
  },
  (t) => ({
    dueIdx: index("wrsj_due_idx")
      .on(t.runAt)
      .where(sql`status = 'pending'`),
    ruleSubjectIdx: index("wrsj_rule_subject_idx").on(t.ruleId, t.subjectType, t.subjectId),
    statusIdx: index("wrsj_status_idx").on(t.status, t.runAt),
    // Monitor: per-tenant scheduled-job status rollup + recent failures.
    tenantStatusIdx: index("wrsj_tenant_status_idx").on(t.tenantId, t.status, t.runAt),
  })
);

export type WorkflowRule = typeof workflowRules.$inferSelect;
export type NewWorkflowRule = typeof workflowRules.$inferInsert;
export type WorkflowRuleExecution = typeof workflowRuleExecutions.$inferSelect;
export type WorkflowRuleScheduledJob = typeof workflowRuleScheduledJobs.$inferSelect;
