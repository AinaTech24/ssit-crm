import { index, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";

/**
 * Monthly branch-metric tracker — the data behind the firm's monthly-meeting MIS
 * tables (branch-wise "AUM Status", "SIP Book Size", and any future metric of the
 * same shape: Target · this-month · % achievement · last-month · MoM).
 *
 * One row per (metricKey × period × source):
 *   - metricKey  'aum' | 'sip_book' | … (see src/lib/finance/metric-config.ts)
 *   - period     the month-end the figure is "as on", 'YYYY-MM'
 *   - source     a branch (branchId set; value pre-filled from the live CRM
 *                rollup, editable to the firm's authoritative figure) OR an
 *                external platform (branchId null, sourceName set — entered
 *                manually, e.g. "Reliance Securities", "IIFL")
 *   - value      the metric value in the metric's display unit (Cr / Lakh / …)
 *   - target     the FY annual target, carried forward month to month
 *
 * The report computes % achievement (value ÷ target) and the month-on-month
 * delta against the immediately preceding period.
 */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    metricKey: text("metric_key").notNull(),
    period: text("period").notNull(), // 'YYYY-MM' month-end
    sourceType: text("source_type", { enum: ["branch", "external"] }).notNull().default("branch"),
    branchId: uuid("branch_id").references(() => branches.id),
    sourceName: text("source_name").notNull(),
    valueNum: numeric("value_num", { precision: 20, scale: 4 }).notNull().default("0"),
    targetNum: numeric("target_num", { precision: 20, scale: 4 }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    // Partial unique indexes (one row per branch / per external name per
    // metric per period) are declared authoritatively in the migration.
    metricPeriodIdx: index("metric_snapshots_lookup_idx").on(t.tenantId, t.metricKey, t.period),
  })
);

export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type NewMetricSnapshot = typeof metricSnapshots.$inferInsert;
