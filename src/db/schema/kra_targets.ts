import { numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Per-person KRA targets — one annual target per (user × metric × fiscal year).
 * The scorecard pro-rates the annual target to the selected period to score
 * actual-vs-target (vs the target-free relative scoring it falls back to).
 * Complements the firm-level `business_targets`.
 */
export const kraTargets = pgTable(
  "kra_targets",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    fiscalYear: text("fiscal_year").notNull(), // 'YYYY-YY'
    metricKey: text("metric_key").notNull(),
    annualTarget: numeric("annual_target", { precision: 18, scale: 2 }).notNull().default("0"),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("kra_targets_unique").on(t.tenantId, t.userId, t.fiscalYear, t.metricKey),
  })
);

export type KraTarget = typeof kraTargets.$inferSelect;
export type NewKraTarget = typeof kraTargets.$inferInsert;
