import { index, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * Annual (FY) targets — a reusable store for the firm's "Target vs Actual"
 * monthly-meeting reports (SIF business, Direct-Equity "Planned 26-27", etc.).
 * Actuals are always computed live; only the target is stored here.
 *
 * Keyed by (metricKey × fiscalYear × scope). Scope is firm / branch / desk so the
 * same metric can carry a target at any level of the Branch → Desk roll-up:
 *   - scopeType 'firm'   → scopeId null
 *   - scopeType 'branch' → scopeId = branches.id
 *   - scopeType 'desk'   → scopeId = desks.id
 *
 * fiscalYear is the Indian FY label, e.g. '2026-27'.
 */
export const annualTargets = pgTable(
  "annual_targets",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    metricKey: text("metric_key").notNull(), // 'sif' | 'equity_brokerage' | …
    fiscalYear: text("fiscal_year").notNull(), // 'YYYY-YY'
    scopeType: text("scope_type", { enum: ["firm", "branch", "desk"] }).notNull(),
    scopeId: uuid("scope_id"),
    targetValue: numeric("target_value", { precision: 20, scale: 2 }).notNull().default("0"),
    ...timestamps,
  },
  (t) => ({
    // Partial unique indexes (one row per scope, handling NULL firm scopeId) are
    // declared authoritatively in the migration.
    lookupIdx: index("annual_targets_lookup_idx").on(t.tenantId, t.metricKey, t.fiscalYear),
  })
);

export type AnnualTarget = typeof annualTargets.$inferSelect;
export type NewAnnualTarget = typeof annualTargets.$inferInsert;
