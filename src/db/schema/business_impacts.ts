import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";

export const businessImpacts = pgTable(
  "business_impacts",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").references(() => investors.id),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    sourceType: text("source_type", {
      enum: ["workflow", "campaign", "next_best_action", "service", "meeting", "manual"],
    }).notNull(),
    sourceId: uuid("source_id"),
    outcome: text("outcome", {
      enum: ["aum_protected", "aum_generated", "sip_recovered", "sip_started", "referral_won", "service_recovery"],
    }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
    monthlySipAmount: numeric("monthly_sip_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => ({
    occurredIdx: index("business_impacts_occurred_idx").on(t.tenantId, t.occurredAt),
    investorIdx: index("business_impacts_investor_idx").on(t.tenantId, t.investorId),
    sourceIdx: index("business_impacts_source_idx").on(t.tenantId, t.sourceType),
  })
);

export type BusinessImpact = typeof businessImpacts.$inferSelect;

