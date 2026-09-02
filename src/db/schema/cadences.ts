/**
 * Cadences / Sequences — enrollable, auto-paced multi-step nurture (Zoho CRM
 * "Cadences" / Sequences parity). Define a sequence of steps with day offsets;
 * enroll a lead; a daily worker materialises each due step (a follow-up task,
 * a reminder, or a logged touch) until the sequence completes. Packages our
 * cadence libs + workflow engine into an enroll-and-run UX.
 */

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const CADENCE_SUBJECTS = ["lead", "investor"] as const;
export const CADENCE_STEP_ACTIONS = ["task", "reminder", "log_touch"] as const;
export type CadenceStepAction = (typeof CADENCE_STEP_ACTIONS)[number];

export type CadenceStep = { dayOffset: number; action: CadenceStepAction; channel?: string; title: string; notes?: string };

export const cadences = pgTable(
  "cadences",
  {
    id,
    tenantId,
    name: text("name").notNull(),
    description: text("description"),
    subjectType: text("subject_type", { enum: CADENCE_SUBJECTS }).notNull().default("lead"),
    steps: jsonb("steps").$type<CadenceStep[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => ({ activeIdx: index("cadences_active_idx").on(t.tenantId, t.subjectType, t.isActive) })
);

export const CADENCE_ENROLLMENT_STATUSES = ["active", "completed", "cancelled"] as const;

export const cadenceEnrollments = pgTable(
  "cadence_enrollments",
  {
    id,
    tenantId,
    cadenceId: uuid("cadence_id").notNull(),
    subjectType: text("subject_type", { enum: CADENCE_SUBJECTS }).notNull().default("lead"),
    subjectId: uuid("subject_id").notNull(),
    subjectName: text("subject_name"),
    /** Index of the next step to run. */
    currentStep: integer("current_step").notNull().default(0),
    status: text("status", { enum: CADENCE_ENROLLMENT_STATUSES }).notNull().default("active"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    enrolledByUserId: uuid("enrolled_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    dueIdx: index("cadence_enrollments_due_idx").on(t.tenantId, t.status, t.nextRunAt),
    subjectIdx: index("cadence_enrollments_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
  })
);

export type Cadence = typeof cadences.$inferSelect;
export type CadenceEnrollment = typeof cadenceEnrollments.$inferSelect;
