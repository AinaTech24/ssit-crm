/**
 * Expected inflows — money a client has told you is coming on a known date
 * (FD maturity, bonus, property sale, LIC maturity, gratuity…).
 *
 * This is the firm's FUTURE AUM pipeline: it answers "what is maturing next
 * quarter across my whole book, and who owns the conversation?" — a question a
 * free-text task could never answer. See migration 0189.
 */

import { date, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { investors } from "./investors";
import { users } from "./users";

export const INFLOW_SOURCE_TYPES = [
  "fd_maturity",
  "insurance_maturity",
  "bonus",
  "property_sale",
  "gratuity",
  "esop",
  "inheritance",
  "ppf_epf",
  "rent",
  "business_income",
  "other",
] as const;
export type InflowSourceType = (typeof INFLOW_SOURCE_TYPES)[number];

export const INFLOW_STATUSES = [
  "expected",
  "confirmed",
  "invested",
  "partially_invested",
  "lapsed",
  "cancelled",
] as const;
export type InflowStatus = (typeof INFLOW_STATUSES)[number];

export const INFLOW_CONFIDENCE = ["high", "medium", "low"] as const;

/** Human labels for the UI — keep in sync with INFLOW_SOURCE_TYPES. */
export const INFLOW_SOURCE_LABELS: Record<InflowSourceType, string> = {
  fd_maturity: "FD maturity",
  insurance_maturity: "Insurance / LIC maturity",
  bonus: "Annual bonus",
  property_sale: "Property sale",
  gratuity: "Gratuity / retirement",
  esop: "ESOP / RSU",
  inheritance: "Inheritance",
  ppf_epf: "PPF / EPF maturity",
  rent: "Rental income",
  business_income: "Business income",
  other: "Other",
};

export const expectedInflows = pgTable(
  "expected_inflows",
  {
    id,
    tenantId,
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id, { onDelete: "cascade" }),
    /** Who owns the follow-through — defaults to the client's RM. */
    ownerId: uuid("owner_id").references(() => users.id),

    sourceType: text("source_type", { enum: INFLOW_SOURCE_TYPES }).notNull().default("other"),
    expectedAmount: numeric("expected_amount", { precision: 18, scale: 2 }),
    /** When the money lands. Use the 1st if only a month is known. */
    expectedOn: date("expected_on").notNull(),
    confidence: text("confidence", { enum: INFLOW_CONFIDENCE }).notNull().default("medium"),

    status: text("status", { enum: INFLOW_STATUSES }).notNull().default("expected"),
    investedAmount: numeric("invested_amount", { precision: 18, scale: 2 }),
    investedAt: date("invested_at"),

    /** Nudge this many days before `expectedOn`. */
    remindDaysBefore: integer("remind_days_before").notNull().default(14),
    /** The task spawned to do the nudging (reuses the task reminder engine). */
    reminderTaskId: uuid("reminder_task_id"),
    notes: text("notes"),

    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    dueIdx: index("expected_inflows_due_idx").on(t.tenantId, t.expectedOn, t.status),
    investorIdx: index("expected_inflows_investor_idx").on(t.tenantId, t.investorId),
    ownerIdx: index("expected_inflows_owner_idx").on(t.tenantId, t.ownerId, t.expectedOn),
  })
);

export type ExpectedInflow = typeof expectedInflows.$inferSelect;
export type NewExpectedInflow = typeof expectedInflows.$inferInsert;

/** Statuses that still represent money we might win. */
export const OPEN_INFLOW_STATUSES: InflowStatus[] = ["expected", "confirmed"];
