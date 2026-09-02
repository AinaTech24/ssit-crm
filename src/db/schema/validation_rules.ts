/**
 * Validation Rules — admin-configurable data-quality gates (Zoho CRM
 * "Validation Rules" parity). Instead of hardcoding "PAN required", an admin
 * defines field-level rules per subject, optionally scoped to a stage, with a
 * block/warn severity. The validator runs on the new-lead / client surfaces.
 */

import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const VALIDATION_SUBJECTS = ["lead", "investor"] as const;
export const VALIDATION_OPERATORS = ["required", "not_empty", "min_length", "regex", "is_email", "is_phone", "is_pan"] as const;
export type ValidationOperator = (typeof VALIDATION_OPERATORS)[number];
export const VALIDATION_SEVERITIES = ["block", "warn"] as const;

export const validationRules = pgTable(
  "validation_rules",
  {
    id,
    tenantId,
    name: text("name").notNull(),
    subjectType: text("subject_type", { enum: VALIDATION_SUBJECTS }).notNull().default("lead"),
    /** Record field key the rule checks (e.g. "pan", "phone", "email", "nominee_name"). */
    field: text("field").notNull(),
    operator: text("operator", { enum: VALIDATION_OPERATORS }).notNull().default("required"),
    /** Comparison value for min_length / regex. */
    value: text("value"),
    /** Optional scoping, e.g. { stage: "onboarding" } — empty = always. */
    appliesWhen: jsonb("applies_when").$type<Record<string, string>>().default({}),
    errorMessage: text("error_message").notNull(),
    severity: text("severity", { enum: VALIDATION_SEVERITIES }).notNull().default("block"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    activeIdx: index("validation_rules_active_idx").on(t.tenantId, t.subjectType, t.isActive),
  })
);

export type ValidationRule = typeof validationRules.$inferSelect;
export type NewValidationRule = typeof validationRules.$inferInsert;
