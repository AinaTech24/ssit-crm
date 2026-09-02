/**
 * Brokerage reconciliation tables.
 *
 * The single biggest financial ROI we can offer an MFD — AssetPlus's own
 * research says trail-fee leakage from wrong ARN mapping / missing
 * trail-on-transfer / delayed installment recognition routinely costs 1–2%
 * on regular-plan AUM. On a ₹50 Cr book that's ₹3–6 lakh/yr leaking.
 *
 * Schema shape:
 *   amc_payouts            — raw lines from CAMS/KFin brokerage statements
 *   commission_records     — period-aggregated expected-vs-received, per scheme
 *
 * Flow:
 *   1. CAMS/KFin reverse-feed parser ingests payout statement → amc_payouts
 *   2. Reconciler worker computes expected trail per folio per month from
 *      transactions + scheme trail rates → commission_records.expected
 *   3. Joins with amc_payouts.received → flags variance > 2% as anomaly
 *   4. UI surfaces anomalies for the owner to chase with the AMC
 */

import { date, decimal, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

/** A single line from an AMC payout statement. */
export const amcPayouts = pgTable(
  "amc_payouts",
  {
    id,
    tenantId,
    period: text("period").notNull(), // 'YYYY-MM'
    amcCode: text("amc_code").notNull(),
    schemeCode: text("scheme_code"),
    schemeName: text("scheme_name"),
    folioNumber: text("folio_number"),
    pan: text("pan"),
    payoutType: text("payout_type", {
      enum: ["upfront", "trail", "transaction", "incentive", "other"],
    })
      .notNull()
      .default("trail"),
    grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull(),
    tdsAmount: numeric("tds_amount", { precision: 18, scale: 2 }).default("0"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
    statementDate: date("statement_date"),
    sourceFeed: text("source_feed", { enum: ["cams", "kfintech", "sundaram", "manual"] }).notNull(),
    rawRow: jsonb("raw_row"),
    ...timestamps,
  },
  (t) => ({
    periodAmcIdx: index("amc_payouts_period_amc_idx").on(t.tenantId, t.period, t.amcCode),
  })
);

/** Period-aggregated expected vs received per scheme (for the variance dashboard). */
export const commissionRecords = pgTable(
  "commission_records",
  {
    id,
    tenantId,
    period: text("period").notNull(), // 'YYYY-MM'
    amcCode: text("amc_code").notNull(),
    schemeCode: text("scheme_code").notNull(),
    schemeName: text("scheme_name"),

    /** Trail rate as % p.a. — pulled from the empanelment slab table. */
    trailRatePct: numeric("trail_rate_pct", { precision: 6, scale: 4 }),

    /** Computed: sum of monthly avg AUM × trail_rate / 12 across folios for this scheme. */
    expectedAmount: numeric("expected_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Sum from amc_payouts matched to this scheme/period. */
    receivedAmount: numeric("received_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Computed: received - expected. Negative = leakage. */
    variance: numeric("variance", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Computed: variance / expected (0..1). > 2% triggers anomaly status. */
    variancePct: numeric("variance_pct", { precision: 7, scale: 4 }).default("0"),

    status: text("status", {
      enum: ["pending", "matched", "anomaly", "investigating", "resolved", "written_off"],
    })
      .notNull()
      .default("pending"),

    folioCount: text("folio_count").default("0"),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    uniqPeriodScheme: uniqueIndex("commission_records_unique").on(
      t.tenantId,
      t.period,
      t.amcCode,
      t.schemeCode
    ),
    anomalyIdx: index("commission_records_anomaly_idx").on(t.tenantId, t.status, t.period),
  })
);

export type AmcPayout = typeof amcPayouts.$inferSelect;
export type CommissionRecord = typeof commissionRecords.$inferSelect;
