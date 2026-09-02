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
 * Logical workflow definition. Versions are immutable; this row points at the
 * currently-published version. In-flight runs continue on the version they
 * started with even after the workflow is republished.
 */
export const workflows = pgTable(
  "workflows",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category", {
      enum: [
        "compliance",
        "retention",
        "onboarding",
        "marketing",
        "operations",
        "internal",
        "service",
        "custom",
      ],
    })
      .notNull()
      .default("custom"),

    /** Non-null if installed from a pre-built recipe. */
    recipeKey: text("recipe_key"),
    currentVersionId: uuid("current_version_id"),

    enabled: boolean("enabled").default(true).notNull(),

    /** Subject + recurrence guard — prevents the same workflow from firing multiple
     *  times on the same subject within the same window. */
    recurrencePolicy: text("recurrence_policy", {
      enum: ["unlimited", "once", "once_per_day", "once_per_week", "once_per_month"],
    })
      .notNull()
      .default("unlimited"),

    /** Hard ceiling per tenant — workflow auto-pauses if it spawns more runs than
     *  this in one hour (circuit breaker against bugs / fan-out runaway). */
    maxRunsPerHour: integer("max_runs_per_hour").default(10000),

    /** A workflow can be paused without being disabled — set automatically when
     *  the circuit breaker trips. */
    pausedReason: text("paused_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    nameUnique: uniqueIndex("workflows_tenant_name_unique").on(t.tenantId, t.name),
    enabledIdx: index("workflows_enabled_idx").on(t.tenantId, t.enabled),
    categoryIdx: index("workflows_category_idx").on(t.tenantId, t.category),
  })
);

/**
 * Immutable graph snapshots. Each save creates a new row; publishing flips the
 * `workflows.currentVersionId` pointer atomically.
 */
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id,
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    tenantId: tenantId.references(() => tenants.id),
    versionNumber: integer("version_number").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    /** Validated DAG plan — see src/lib/workflow/schema.ts */
    graph: jsonb("graph").notNull(),
    /** Run-scope variables schema, derived from graph */
    variablesSchema: jsonb("variables_schema"),
    /** Cached validation result */
    validationReport: jsonb("validation_report"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    versionUnique: uniqueIndex("workflow_versions_unique").on(t.workflowId, t.versionNumber),
    draftIdx: index("workflow_versions_draft_idx").on(t.workflowId).where(sql`status = 'draft'`),
  })
);

/**
 * One workflow can have multiple triggers (e.g., schedule + manual + record-event).
 */
export const workflowTriggers = pgTable(
  "workflow_triggers",
  {
    id,
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    tenantId: tenantId.references(() => tenants.id),
    kind: text("kind", {
      enum: [
        "record_event",
        "schedule",
        "inbound_message",
        "webhook",
        "segment_entry",
        "segment_exit",
        "manual",
        "record_imported",
        "communication_event",
      ],
    }).notNull(),
    /** Per-kind config. See lib/workflow/triggers/<kind>.ts for schema. */
    config: jsonb("config").notNull(),
    /** Optional pre-filter AST applied at trigger time. */
    criteria: jsonb("criteria"),
    enabled: boolean("enabled").default(true).notNull(),
    cronExpression: text("cron_expression"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    kindIdx: index("wf_triggers_kind_idx").on(t.kind, t.enabled),
    scheduleIdx: index("wf_triggers_schedule_idx")
      .on(t.nextRunAt)
      .where(sql`kind = 'schedule' AND enabled = true`),
  })
);

/**
 * One execution of a workflow. Bound to a subject (usually an investor).
 */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id,
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => workflowVersions.id),
    tenantId: tenantId.references(() => tenants.id),

    triggeredBy: text("triggered_by", {
      enum: ["event", "schedule", "manual", "webhook", "recipe"],
    }).notNull(),
    triggerId: uuid("trigger_id").references(() => workflowTriggers.id),

    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),

    /** Run-scope variable accumulator. Available to all downstream nodes as
     *  `vars.<key>`. Populated by triggers, `ai_compose`, and other actions. */
    variables: jsonb("variables").$type<Record<string, unknown>>().default({}),

    /** Snapshot of subject at trigger time — used for criteria matching even if
     *  the subject is later modified. */
    contextSnapshot: jsonb("context_snapshot"),

    status: text("status", {
      enum: ["queued", "running", "paused", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),

    /** wait_for_event / wait_until_date support */
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    waitPredicate: jsonb("wait_predicate"),
    waitNodeId: text("wait_node_id"),

    /** Current node — used by the runner to know what to execute next */
    currentNodeId: text("current_node_id"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    /** How many times this run was manually re-queued from the monitor. Capped
     *  so a deterministically-failing run can't be retried forever. */
    retryCount: integer("retry_count").notNull().default(0),
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    workflowStatusIdx: index("wf_runs_workflow_status_idx").on(t.workflowId, t.status),
    subjectIdx: index("wf_runs_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
    pausedIdx: index("wf_runs_paused_idx").on(t.pausedUntil).where(sql`status = 'paused'`),
    // Monitor (Control Tower): status rollup + recent failures per tenant/window.
    tenantStatusCreatedIdx: index("wf_runs_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    activeSubjectUnique: uniqueIndex("wf_runs_active_subject_unique")
      .on(t.workflowId, t.subjectType, t.subjectId)
      .where(sql`status IN ('queued', 'running', 'paused')`),
  })
);

/**
 * Step-level audit. Each step execution attempt is a row. Use to replay,
 * debug, and feed observability dashboards.
 */
export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id,
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    tenantId: tenantId.references(() => tenants.id),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "skipped"],
    }).notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
    /** Compliance + dispatch trail for send_* actions */
    sideEffects: jsonb("side_effects"),
    ...timestamps,
  },
  (t) => ({
    runIdx: index("wf_steps_run_idx").on(t.runId, t.nodeId),
    failedIdx: index("wf_steps_failed_idx").on(t.status, t.completedAt).where(sql`status = 'failed'`),
  })
);

/**
 * Pre-built recipes shipped with the platform. Tenants install via UI.
 */
export const recipes = pgTable("recipes", {
  id,
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  /** Source graph + metadata, copied into workflows on install. */
  graph: jsonb("graph").notNull(),
  defaultTemplates: jsonb("default_templates"),
  tags: jsonb("tags").$type<string[]>().default([]),
  ...timestamps,
});

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type WorkflowTrigger = typeof workflowTriggers.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
