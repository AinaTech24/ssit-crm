/**
 * Blueprint engine — formal stage machines for end-to-end journeys.
 *
 * The first blueprint we ship is the lead-to-client journey (15 stages). The
 * engine is module-agnostic — a tenant can later define blueprints for
 * service-request resolution, complaint escalation, onboarding, etc.
 *
 * Model:
 *   blueprint_definitions   — top-level config (one per module-journey)
 *   blueprint_stages        — ordered stages with required fields, owner, SLA
 *   blueprint_transitions   — explicit edges with role + condition gates
 *   lead_blueprint_instances — per-lead "current stage" + meta
 *   lead_stage_history       — append-only audit of every transition
 */

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
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

// ────────────────────────────────────────────────────────────────────────
// Definitions
// ────────────────────────────────────────────────────────────────────────

export const blueprintDefinitions = pgTable(
  "blueprint_definitions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** "leads" | "service_requests" | "onboarding" | "complaints" — the module
     *  this blueprint applies to. */
    moduleName: text("module_name").notNull(),
    blueprintName: text("blueprint_name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    /** Optional version pin — bumping creates a new row + flips is_active. */
    versionNumber: integer("version_number").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    moduleIdx: index("bd_module_idx").on(t.tenantId, t.moduleName, t.isActive),
    nameUnique: uniqueIndex("bd_tenant_name_unique").on(t.tenantId, t.moduleName, t.blueprintName, t.versionNumber),
  })
);

export const blueprintStages = pgTable(
  "blueprint_stages",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    blueprintId: uuid("blueprint_id")
      .notNull()
      .references(() => blueprintDefinitions.id, { onDelete: "cascade" }),

    /** Machine key (slug). Used in transitions + URL params. */
    stageKey: text("stage_key").notNull(),
    stageName: text("stage_name").notNull(),
    description: text("description"),
    stageOrder: integer("stage_order").notNull(),

    /** Role that owns this stage — drives the "assigned to" badge + alerts. */
    ownerRole: text("owner_role"),

    /** Required-field keys on the subject record. Empty = no field gates. */
    requiredFields: jsonb("required_fields").$type<string[]>().default([]),

    /** SLA — fire a delayed flag + escalation if stage doesn't exit in N days. */
    slaDays: integer("sla_days"),

    /** Conditions that must hold to enter this stage (free-form jsonb so the
     *  engine can evolve without schema migrations). */
    enterConditions: jsonb("enter_conditions"),
    /** Conditions that must hold to exit this stage. */
    exitConditions: jsonb("exit_conditions"),

    /** Allowed actions in this stage — drives the UI button visibility.
     *  e.g. ["send_welcome", "schedule_call"] */
    allowedActions: jsonb("allowed_actions").$type<string[]>().default([]),

    /** Auto-fire workflows when entering this stage (recipe keys). */
    automationsOnEnter: jsonb("automations_on_enter").$type<string[]>().default([]),
    /** Auto-fire workflows when leaving this stage. */
    automationsOnExit: jsonb("automations_on_exit").$type<string[]>().default([]),

    ...timestamps,
  },
  (t) => ({
    blueprintIdx: index("bs_blueprint_idx").on(t.blueprintId, t.stageOrder),
    keyUnique: uniqueIndex("bs_blueprint_key_unique").on(t.blueprintId, t.stageKey),
  })
);

export const blueprintTransitions = pgTable(
  "blueprint_transitions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    blueprintId: uuid("blueprint_id")
      .notNull()
      .references(() => blueprintDefinitions.id, { onDelete: "cascade" }),

    fromStageKey: text("from_stage_key").notNull(),
    toStageKey: text("to_stage_key").notNull(),
    transitionName: text("transition_name").notNull(),

    /** Conditions that must hold before this transition is allowed. */
    requiredConditions: jsonb("required_conditions"),

    /** Roles allowed to invoke this transition. */
    allowedRoles: jsonb("allowed_roles").$type<string[]>().default([]),

    ...timestamps,
  },
  (t) => ({
    blueprintIdx: index("bt_blueprint_idx").on(t.blueprintId),
    fromToUnique: uniqueIndex("bt_blueprint_from_to_unique").on(t.blueprintId, t.fromStageKey, t.toStageKey),
  })
);

// ────────────────────────────────────────────────────────────────────────
// Per-lead instance + history
// ────────────────────────────────────────────────────────────────────────

export const leadBlueprintInstances = pgTable(
  "lead_blueprint_instances",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    leadId: uuid("lead_id").notNull(),
    blueprintId: uuid("blueprint_id")
      .notNull()
      .references(() => blueprintDefinitions.id),

    currentStageKey: text("current_stage_key").notNull(),
    status: text("status", {
      enum: ["in_progress", "completed", "abandoned", "lost"],
    })
      .notNull()
      .default("in_progress"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** True if `now - stageEnteredAt > stage.slaDays`. Set by the SLA worker. */
    isDelayed: boolean("is_delayed").notNull().default(false),
    delayedSince: timestamp("delayed_since", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    leadUnique: uniqueIndex("lbi_lead_unique").on(t.tenantId, t.leadId),
    stageIdx: index("lbi_stage_idx").on(t.tenantId, t.currentStageKey, t.status),
    delayedIdx: index("lbi_delayed_idx").on(t.tenantId, t.isDelayed).where(undefined as any),
  })
);

export const leadStageHistory = pgTable(
  "lead_stage_history",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    leadId: uuid("lead_id").notNull(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => leadBlueprintInstances.id, { onDelete: "cascade" }),

    stageKey: text("stage_key").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    /** Computed seconds in stage — set on exit. */
    durationSeconds: integer("duration_seconds"),

    /** Did we breach this stage's SLA before exiting? */
    breachedSla: boolean("breached_sla").notNull().default(false),

    /** Actor who CLOSED this row (stamped on exit). */
    completedBy: uuid("completed_by").references(() => users.id),
    /** Actor who OPENED this row (stamped on entry) — so the current stage's
     *  actor is recorded, not only the exiting one. Null for system/auto moves. */
    enteredBy: uuid("entered_by").references(() => users.id),
    transitionName: text("transition_name"),
    remarks: text("remarks"),

    ...timestamps,
  },
  (t) => ({
    leadIdx: index("lsh_lead_idx").on(t.tenantId, t.leadId, t.enteredAt),
    instanceIdx: index("lsh_instance_idx").on(t.instanceId, t.enteredAt),
  })
);

// ── Polymorphic instances (any subject_type) ─────────────────────────────

export const blueprintInstances = pgTable(
  "blueprint_instances",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    blueprintId: uuid("blueprint_id").notNull().references(() => blueprintDefinitions.id),
    subjectType: text("subject_type").notNull(), // "lead" | "service_request" | "complaint" | "sip_rejection" | "investor" (review)
    subjectId: uuid("subject_id").notNull(),
    currentStageKey: text("current_stage_key").notNull(),
    status: text("status", { enum: ["in_progress", "completed", "abandoned", "lost"] })
      .notNull()
      .default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    isDelayed: boolean("is_delayed").notNull().default(false),
    delayedSince: timestamp("delayed_since", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    subjectUnique: uniqueIndex("bi_subject_unique").on(t.tenantId, t.subjectType, t.subjectId),
    stageIdx: index("bi_stage_idx").on(t.tenantId, t.currentStageKey, t.status),
    blueprintIdx: index("bi_blueprint_idx").on(t.blueprintId),
  })
);

export const blueprintStageHistory = pgTable(
  "blueprint_stage_history",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    instanceId: uuid("instance_id").notNull().references(() => blueprintInstances.id, { onDelete: "cascade" }),
    stageKey: text("stage_key").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    breachedSla: boolean("breached_sla").notNull().default(false),
    completedBy: uuid("completed_by").references(() => users.id),
    transitionName: text("transition_name"),
    remarks: text("remarks"),
    ...timestamps,
  },
  (t) => ({
    subjectIdx: index("bsh_subject_idx").on(t.tenantId, t.subjectType, t.subjectId, t.enteredAt),
    instanceIdx: index("bsh_instance_idx").on(t.instanceId, t.enteredAt),
  })
);

export type BlueprintDefinition = typeof blueprintDefinitions.$inferSelect;
export type BlueprintStage = typeof blueprintStages.$inferSelect;
export type BlueprintTransition = typeof blueprintTransitions.$inferSelect;
export type LeadBlueprintInstance = typeof leadBlueprintInstances.$inferSelect;
export type LeadStageHistory = typeof leadStageHistory.$inferSelect;
export type BlueprintInstance = typeof blueprintInstances.$inferSelect;
export type BlueprintHistoryRow = typeof blueprintStageHistory.$inferSelect;
