import { index, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * EFFORTS tracker (Finowise "EFFORTS × EFFECTIVENESS = RESULT") — monthly Plan vs
 * Actual for leading activity metrics (internal reviews, review meetings, lead
 * meetings, IAPs/FWPs, new leads, FBPs). One row per (period × metric). Actuals
 * for some metrics auto-fill from the CRM (new leads, FBPs); all are editable.
 */
export const effortEntries = pgTable(
  "effort_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    period: text("period").notNull(), // 'YYYY-MM'
    metricKey: text("metric_key").notNull(),
    planned: numeric("planned", { precision: 14, scale: 2 }).notNull().default("0"),
    actual: numeric("actual", { precision: 14, scale: 2 }).notNull().default("0"),
    ...timestamps,
  },
  (t) => ({
    periodIdx: index("effort_entries_period_idx").on(t.tenantId, t.period),
    unique: uniqueIndex("effort_entries_unique").on(t.tenantId, t.period, t.metricKey),
  })
);

export type EffortEntry = typeof effortEntries.$inferSelect;
