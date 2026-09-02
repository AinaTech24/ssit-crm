/**
 * Assignment Rules — auto-distribute new leads / clients to RMs (Zoho CRM
 * "Assignment Rules" parity). Instead of manual owner-picking, a new record is
 * routed by the first matching active rule using a strategy:
 *   - round_robin   → rotate through targetUserIds (rrCursor tracks position)
 *   - load_balanced → the target RM with the fewest open leads right now
 *   - specific      → always a single RM
 *
 * Optional `criteria` narrows a rule to a lead source / segment so different
 * intake channels route to different teams.
 */

import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const ASSIGNMENT_SUBJECTS = ["lead", "investor"] as const;
export const ASSIGNMENT_STRATEGIES = ["round_robin", "load_balanced", "specific"] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export const assignmentRules = pgTable(
  "assignment_rules",
  {
    id,
    tenantId,
    name: text("name").notNull(),
    subjectType: text("subject_type", { enum: ASSIGNMENT_SUBJECTS }).notNull().default("lead"),
    strategy: text("strategy", { enum: ASSIGNMENT_STRATEGIES }).notNull().default("round_robin"),
    /** RMs to rotate among (round-robin / load-balanced) or the single target (specific = first). */
    targetUserIds: jsonb("target_user_ids").$type<string[]>().notNull().default([]),
    /** Optional narrowing, e.g. { source: "Website", segmentTag: "HNI" }. Empty = applies to all. */
    criteria: jsonb("criteria").$type<Record<string, string>>().default({}),
    /** Lower runs first; first matching active rule wins. */
    priority: integer("priority").notNull().default(100),
    /** Round-robin pointer (index into targetUserIds). */
    rrCursor: integer("rr_cursor").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    activeIdx: index("assignment_rules_active_idx").on(t.tenantId, t.subjectType, t.isActive, t.priority),
  })
);

export type AssignmentRule = typeof assignmentRules.$inferSelect;
export type NewAssignmentRule = typeof assignmentRules.$inferInsert;
