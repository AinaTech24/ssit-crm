/**
 * Portfolio Review Items — Network FP "3.4 Portfolio Review" parity.
 *
 * Per-folio review snapshot tied to a specific review meeting. One row
 * per (meeting × folio). The RM's working document during the meeting,
 * with qualitative notes per holding and a recommended action.
 *
 * Snapshot semantics: numbers are frozen at review time so the
 * historical view matches what the client saw.
 */

import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { reviewMeetings } from "./review_meetings";
import { folios } from "./folios";
import { schemeMaster } from "./masters";
import { users } from "./users";

export const RECOMMENDED_ACTIONS = [
  "hold",
  "no_action",
  "switch",
  "exit",
  "increase",
  "decrease",
  "pause_sip",
  "resume_sip",
  "new_sip",
  "step_up",
  "step_down",
] as const;

export const INVESTMENT_TYPES = ["sip", "lumpsum", "mixed"] as const;

export const portfolioReviewItems = pgTable(
  "portfolio_review_items",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => reviewMeetings.id, { onDelete: "cascade" }),
    folioId: uuid("folio_id")
      .notNull()
      .references(() => folios.id),

    /** Denormalised so the row survives folio archive. */
    schemeName: text("scheme_name"),
    fundCategory: text("fund_category"),
    investmentType: text("investment_type", { enum: INVESTMENT_TYPES }),

    /** Snapshot at review time. */
    snapshotCurrentValue: numeric("snapshot_current_value", {
      precision: 18,
      scale: 2,
    }),
    snapshotInvestedAmount: numeric("snapshot_invested_amount", {
      precision: 18,
      scale: 2,
    }),
    snapshotUnits: numeric("snapshot_units", { precision: 18, scale: 6 }),
    startDate: date("start_date"),
    holdingPeriodMonths: integer("holding_period_months"),
    returnPct: numeric("return_pct", { precision: 8, scale: 4 }),

    /** Qualitative notes — filled during the meeting. */
    exitLoadNote: text("exit_load_note"),
    taxImplicationNote: text("tax_implication_note"),
    pastPerformanceNote: text("past_performance_note"),
    suitabilityNote: text("suitability_note"),

    recommendedAction: text("recommended_action", { enum: RECOMMENDED_ACTIONS })
      .default("hold"),

    /** Target scheme when action='switch'. */
    targetSchemeId: uuid("target_scheme_id").references(() => schemeMaster.id),
    /** ₹ when action ∈ {increase, new_sip, step_up}. */
    actionAmount: numeric("action_amount", { precision: 18, scale: 2 }),

    rationale: text("rationale"),
    remarks: text("remarks"),

    /** Stamped when the action is actually executed. */
    actionTakenAt: timestamp("action_taken_at", { withTimezone: true }),
    actionTakenBy: uuid("action_taken_by").references(() => users.id),

    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    uniqueMeetingFolio: uniqueIndex("portfolio_review_items_unique").on(
      t.meetingId,
      t.folioId
    ),
    tenantMeetingIdx: index(
      "portfolio_review_items_tenant_meeting_idx"
    ).on(t.tenantId, t.meetingId),
  })
);

export type PortfolioReviewItem = typeof portfolioReviewItems.$inferSelect;
export type NewPortfolioReviewItem =
  typeof portfolioReviewItems.$inferInsert;
