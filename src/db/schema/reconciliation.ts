import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";

/**
 * A single reconciliation sweep (one tenant, one kind). Holds the headline
 * counters; the per-discrepancy detail lives in reconciliation_exceptions.
 */
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    kind: text("kind").notNull().default("holdings"),
    runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
    scanned: integer("scanned").notNull().default(0),
    exceptionsFound: integer("exceptions_found").notNull().default(0),
    status: text("status").notNull().default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("reconciliation_runs_tenant_idx").on(t.tenantId, t.runAt),
  })
);

/**
 * One matched discrepancy across the three legs (CRM ledger / RTA-CAS stated /
 * live valuation). Re-running reconciliation upserts on (tenant, dedup_key) so
 * a persistent break stays one row (last_seen_at bumped) and a healed break is
 * auto-resolved.
 */
export const reconciliationExceptions = pgTable(
  "reconciliation_exceptions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    runId: uuid("run_id"),
    investorId: uuid("investor_id").references(() => investors.id),
    folioNumber: text("folio_number"),
    schemeCode: text("scheme_code"),
    schemeName: text("scheme_name"),
    /** unit_mismatch | missing_in_crm | missing_in_feed | value_drift */
    exceptionType: text("exception_type").notNull(),
    /** high | medium | low */
    severity: text("severity").notNull().default("medium"),
    crmUnits: numeric("crm_units", { precision: 18, scale: 4 }),
    feedUnits: numeric("feed_units", { precision: 18, scale: 4 }),
    deltaUnits: numeric("delta_units", { precision: 18, scale: 4 }),
    crmValue: numeric("crm_value", { precision: 18, scale: 2 }),
    feedValue: numeric("feed_value", { precision: 18, scale: 2 }),
    deltaValue: numeric("delta_value", { precision: 18, scale: 2 }),
    /** open | investigating | resolved | ignored */
    status: text("status").notNull().default("open"),
    notes: text("notes"),
    dedupKey: text("dedup_key").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
    ...timestamps,
  },
  (t) => ({
    dedup: uniqueIndex("reconciliation_exceptions_dedup").on(t.tenantId, t.dedupKey),
    openIdx: index("reconciliation_exceptions_open_idx").on(t.tenantId, t.status, t.severity, t.detectedAt),
    investorIdx: index("reconciliation_exceptions_investor_idx").on(t.tenantId, t.investorId),
  })
);

export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
export type ReconciliationException = typeof reconciliationExceptions.$inferSelect;
