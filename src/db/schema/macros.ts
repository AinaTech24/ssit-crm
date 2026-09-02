/**
 * Macros — one-click action bundles (Zoho CRM "Macros" parity). An RM fires a
 * named bundle of server-executable steps from a lead / client in one click,
 * e.g. "After first call": log a call activity + create a 2-day follow-up task
 * + add a note. Reuses our activities + tasks + (lead) stage engines.
 */

import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const MACRO_SUBJECTS = ["lead", "investor"] as const;
/** Server-executable step kinds (no manual send — those stay one-tap links). */
export const MACRO_STEP_TYPES = ["create_task", "log_activity", "add_note", "advance_stage", "set_followup"] as const;
export type MacroStepType = (typeof MACRO_STEP_TYPES)[number];

export type MacroStep = { type: MacroStepType; config: Record<string, any> };

export const macros = pgTable(
  "macros",
  {
    id,
    tenantId,
    name: text("name").notNull(),
    description: text("description"),
    subjectType: text("subject_type", { enum: MACRO_SUBJECTS }).notNull().default("lead"),
    steps: jsonb("steps").$type<MacroStep[]>().notNull().default([]),
    icon: text("icon"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    activeIdx: index("macros_active_idx").on(t.tenantId, t.subjectType, t.isActive),
  })
);

export type Macro = typeof macros.$inferSelect;
export type NewMacro = typeof macros.$inferInsert;
