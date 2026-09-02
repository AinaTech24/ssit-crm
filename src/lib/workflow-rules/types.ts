/**
 * Zod schemas for workflow_rules.triggerConfig, criteriaRows, and actions.
 *
 * Mirrors the Zoho CRM model:
 *   - Trigger types: record_action / date_field / score_change / note / recommendation / competitor / recurrence
 *   - Criteria: array of { field, operator, value } combined by a pattern string ("1 AND (2 OR 3)")
 *   - Actions: instant (run now) and scheduled (run after delay)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Trigger configs (per triggerType)
// ---------------------------------------------------------------------------

/**
 * Zoho's "When [field] is modified to [operator] [value]" row. `operator: "any"`
 * means "modified to any value" (just changed). Otherwise the field must have
 * changed AND the NEW value must satisfy the operator/value (reuses the criteria
 * operator engine).
 */
export const FieldConditionSchema = z.object({
  field: z.string(),
  operator: z.string().default("any"),
  value: z.unknown().optional(),
});

export type FieldCondition = z.infer<typeof FieldConditionSchema>;

export const RecordActionTriggerSchema = z.object({
  /** Zoho's "Create" / "Edit" / "Create or Edit" / "Delete" / "Field Update" */
  when: z.enum(["create", "edit", "create_or_edit", "delete", "field_update"]),
  /** Zoho's Edit modifier: 'any' field gets modified vs 'specific' field(s). */
  editMode: z.enum(["any", "specific"]).optional(),
  /** For "Edit" + "Field Update": only fire when these fields change.
   *  Empty = any field. Max 5 (matches Zoho). */
  fields: z.array(z.string()).max(5).default([]),
  /** Zoho's "When [field] is modified to [operator][value]" rows (editMode='specific').
   *  ALL rows must hold: the field changed AND the new value matches the operator. */
  fieldConditions: z.array(FieldConditionSchema).max(10).optional(),
  /** Zoho's "Repeat this workflow every time a record is edited" toggle. */
  repeat: z.boolean().default(false),
});

export const DateFieldTriggerSchema = z.object({
  /** Date field on the module (must be `dateAnchor: true` in catalog). */
  field: z.string(),
  /** Run N days/weeks/months before / on / after the date. */
  when: z.enum(["before", "on", "after"]),
  offset: z.number().int().nonnegative().default(0),
  unit: z.enum(["day", "week", "month"]).default("day"),
  /** Zoho's recurrence: once, every month, every year. */
  recurrence: z.enum(["once", "every_month", "every_year"]).default("once"),
  /** Time of day to fire (HH:mm). */
  time: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
});

export const ScoreChangeTriggerSchema = z.object({
  /** Score field on the module (must be `scoreField: true` in catalog). */
  field: z.string(),
  direction: z.enum(["increase", "decrease", "updated"]).default("updated"),
  /** Optional threshold — e.g., fire only when score crosses 75. */
  threshold: z.number().optional(),
});

export const RecurrenceTriggerSchema = z.object({
  /** Cron expression, e.g. "0 9 * * 1" = every Mon 9:00am. */
  cron: z.string(),
  /** Optional human-readable description shown in UI. */
  description: z.string().optional(),
});

export const NoteTriggerSchema = z.object({
  /** "Note Added" / "Modified" / "Deleted" / "Added or Modified". */
  when: z.enum(["added", "modified", "deleted", "added_or_modified"]),
});

export const TriggerConfigSchema = z.union([
  RecordActionTriggerSchema,
  DateFieldTriggerSchema,
  ScoreChangeTriggerSchema,
  RecurrenceTriggerSchema,
  NoteTriggerSchema,
]);

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

export const CRITERIA_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "greater_than",
  "less_than",
  "greater_or_equal",
  "less_or_equal",
  "between",
  "in",
  "not_in",
  "today",
  "yesterday",
  "tomorrow",
  "last_n_days",
  "next_n_days",
] as const;

export type CriteriaOperator = (typeof CRITERIA_OPERATORS)[number];

export const CriteriaRowSchema = z.object({
  field: z.string(),
  operator: z.enum(CRITERIA_OPERATORS),
  /** Can be: scalar, array (for in/not_in/between), or number (for last_n_days). */
  value: z.unknown().optional(),
});

export type CriteriaRow = z.infer<typeof CriteriaRowSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Zoho's instant actions:
 *   email_notification, task, meeting, call, field_update, tag, webhook,
 *   custom_function, record_creation, convert, slack_notification
 *
 * Our mapping (we reuse the existing workflow-engine action handlers):
 *   send_email           ↔ Email Notification
 *   send_whatsapp        ↔ (Zoho doesn't have this; we add it)
 *   send_sms             ↔ (Zoho doesn't have this; we add it)
 *   create_task          ↔ Task
 *   schedule_meeting     ↔ Meeting (creates a review_meeting row)
 *   schedule_call        ↔ Call (creates a task with type=call)
 *   update_field         ↔ Field Update
 *   add_tag / remove_tag ↔ Tag
 *   webhook              ↔ Webhook
 *   custom_function      ↔ Custom Function (server-side Deluge-like JS)
 *   create_record        ↔ Record Creation (in any module)
 *   convert_lead         ↔ Convert (lead → investor)
 *   create_notification  ↔ In-app notification
 */
export const ACTION_TYPES = [
  "send_email",
  "send_whatsapp",
  "send_sms",
  "create_task",
  "schedule_meeting",
  "schedule_call",
  "update_field",
  "add_tag",
  "remove_tag",
  "webhook",
  "custom_function",
  "create_record",
  "convert_lead",
  "create_notification",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

// Generic action — config validation is done per-handler.
export const ActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  /** Optional human label for the rule summary. */
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const ScheduledActionSchema = ActionSchema.extend({
  delay: z.object({
    amount: z.number().int().min(1).max(365),
    unit: z.enum(["minute", "hour", "day", "week"]),
    /** Where the delay clock starts from. Default: 'trigger' (rule firing time). */
    anchor: z.enum(["trigger", "date_field"]).default("trigger"),
    /** When anchor='date_field', which field. */
    anchorField: z.string().optional(),
  }),
});

export type Action = z.infer<typeof ActionSchema>;
export type ScheduledAction = z.infer<typeof ScheduledActionSchema>;

// ---------------------------------------------------------------------------
// Condition branches — Zoho lets one rule hold up to 10 condition sets, each
// with its own actions. A record falls into the FIRST branch whose criteria
// match (top-down). When `branches` is empty the legacy single
// criteriaRows/instantActions/scheduledActions fields apply.
// ---------------------------------------------------------------------------

export const RuleBranchSchema = z.object({
  name: z.string().max(80).optional(),
  criteriaPattern: z.string().nullable().optional(),
  criteriaRows: z.array(CriteriaRowSchema).max(10).default([]),
  instantActions: z.array(ActionSchema).max(20).default([]),
  scheduledActions: z.array(ScheduledActionSchema).max(20).default([]),
});

export type RuleBranch = z.infer<typeof RuleBranchSchema>;

// ---------------------------------------------------------------------------
// Full rule shape (for API + UI)
// ---------------------------------------------------------------------------

export const WorkflowRuleSchema = z.object({
  module: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  triggerType: z.enum([
    "record_action",
    "date_field",
    "score_change",
    "note",
    "recommendation",
    "competitor",
    "recurrence",
  ]),
  triggerConfig: z.record(z.string(), z.unknown()),
  /** Pattern like "1 AND (2 OR 3)" — defaults to AND of all rows. */
  criteriaPattern: z.string().nullable().optional(),
  criteriaRows: z.array(CriteriaRowSchema).max(10).default([]),
  instantActions: z.array(ActionSchema).max(20).default([]),
  scheduledActions: z.array(ScheduledActionSchema).max(20).default([]),
  /** Extra condition branches beyond the main criteria (Zoho: ≤10 per rule).
   *  When present, branches are evaluated top-down and the first match wins;
   *  the main criteria/actions above act as branch #1. */
  branches: z.array(RuleBranchSchema).max(10).default([]),
  enabled: z.boolean().default(true),
  executionOrder: z.number().int().default(100),
  /** Safety throttle — max event-triggered firings per trailing hour. NULL/omitted = unlimited. */
  rateLimitPerHour: z.number().int().min(1).max(100000).nullable().optional(),
});

export type WorkflowRuleInput = z.infer<typeof WorkflowRuleSchema>;
