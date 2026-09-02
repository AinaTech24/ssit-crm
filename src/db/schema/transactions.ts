import { date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { folios } from "./folios";
import { users } from "./users";

export const transactions = pgTable(
  "transactions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    folioId: uuid("folio_id").references(() => folios.id),
    folioNumber: text("folio_number"),
    amcCode: text("amc_code"),
    amcName: text("amc_name"),
    schemeCode: text("scheme_code"),
    schemeName: text("scheme_name"),
    /** Spec § Module 9 — Equity / Debt / Hybrid / Liquid / ELSS / Index / etc. */
    schemeCategory: text("scheme_category"),

    /**
     * Transaction type — spec § Module 9:
     *   Purchase · Redemption · Switch · SIP · SIP Stop · SIP Pause · STP · SWP
     * Legacy slugs retained for back-compat with already-imported feed rows.
     */
    type: text("type", {
      enum: [
        // Spec-canonical (8)
        "purchase",
        "redemption",
        "switch",
        "sip",
        "sip_stop",
        "sip_pause",
        "stp",
        "swp",
        // Legacy
        "lumpsum",
        "dividend_payout",
        "dividend_reinvest",
      ],
    }).notNull(),
    direction: text("direction", { enum: ["inflow", "outflow"] }).notNull(),

    amount: numeric("amount", { precision: 18, scale: 2 }),
    units: numeric("units", { precision: 18, scale: 4 }),
    nav: numeric("nav", { precision: 12, scale: 4 }),

    /** Source order id from BSE/NSE */
    orderId: text("order_id"),
    orderDate: date("order_date"),
    settlementDate: date("settlement_date"),
    nseBseFlag: text("exchange", { enum: ["BSE", "NSE", "MFU", "DIRECT"] }),

    /**
     * Status — spec § Module 9: Pending · Processed · Rejected · Cancelled.
     * Legacy values (submitted, successful, failed) retained.
     */
    status: text("status", {
      enum: [
        "pending",
        "processed",
        "rejected",
        "cancelled",
        "submitted",
        "successful",
        "failed",
      ],
    }).notNull().default("pending"),
    reasonCode: text("reason_code"),
    reasonDescription: text("reason_description"),

    /** EUIN of executing employee (regulatory) */
    executedByUserId: uuid("executed_by").references(() => users.id),
    executedEuin: text("executed_euin"),

    /**
     * Source — spec § Module 9: Manual · CAMS · KFintech · NSE · MFU · Other.
     * Legacy values (bse, import) retained.
     */
    sourceFeed: text("source_feed", {
      enum: ["manual", "cams", "kfintech", "nse", "mfu", "other", "bse", "import"],
    }),
    rawFeedRow: jsonb("raw_feed_row"),

    /** Free-text RM remarks — spec § Module 9. */
    remarks: text("remarks"),

    /** Import idempotency key — real order_id when available, else a hash of the
     *  natural transaction key. Unique per tenant; makes re-import a no-op. */
    dedupKey: text("dedup_key"),

    ...timestamps,
  },
  (t) => ({
    investorIdx: index("tx_investor_idx").on(t.tenantId, t.investorId, t.orderDate),
    statusIdx: index("tx_status_idx").on(t.tenantId, t.status),
    typeIdx: index("tx_type_idx").on(t.tenantId, t.type, t.orderDate),
    orderUnique: uniqueIndex("tx_tenant_order_unique").on(t.tenantId, t.orderId).where(sql`order_id IS NOT NULL`),
    dedupUnique: uniqueIndex("tx_tenant_dedup_unique").on(t.tenantId, t.dedupKey),
  })
);

export const mandates = pgTable(
  "mandates",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    mandateRefNo: text("mandate_ref_no").notNull(),
    bankAccountMasked: text("bank_account_masked"),
    ifsc: text("ifsc"),
    amountLimit: numeric("amount_limit", { precision: 18, scale: 2 }),
    registeredAt: date("registered_at"),
    expiresAt: date("expires_at"),
    status: text("status", { enum: ["pending", "active", "expired", "rejected", "cancelled"] })
      .notNull()
      .default("pending"),
    ...timestamps,
  },
  (t) => ({
    refUnique: uniqueIndex("mandates_tenant_ref_unique").on(t.tenantId, t.mandateRefNo),
    expiryIdx: index("mandates_expiry_idx").on(t.tenantId, t.expiresAt),
  })
);

export const sips = pgTable(
  "sips",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    folioId: uuid("folio_id").references(() => folios.id),
    /** Denormalised folio + AMC for fast list rendering — populated on insert / import. */
    folioNumber: text("folio_number"),
    amcCode: text("amc_code"),
    amcName: text("amc_name"),
    schemeCode: text("scheme_code"),
    schemeName: text("scheme_name"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    frequency: text("frequency", { enum: ["monthly", "quarterly", "weekly", "fortnightly", "yearly"] })
      .notNull()
      .default("monthly"),
    sipDate: text("sip_date"), // day of month "1".."28"
    startDate: date("start_date"),
    endDate: date("end_date"),
    nextInstallmentAt: date("next_installment_at"),
    mandateId: uuid("mandate_id").references(() => mandates.id),
    /**
     * SIP Status — per spec § Module 10:
     *   Active · Paused · Stopped · Rejected · Completed
     * Legacy values (pending, expired) retained for back-compat.
     */
    status: text("status", {
      enum: ["active", "paused", "stopped", "rejected", "completed", "pending", "expired"],
    })
      .notNull()
      .default("pending"),
    consecutiveFailures: text("consecutive_failures").default("0"),
    /** Owning RM — defaults to the investor's RM but can be overridden per SIP. */
    rmId: uuid("rm_id").references(() => users.id),
    /** Free-text remarks — spec § Module 10. */
    remarks: text("remarks"),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("sips_status_idx").on(t.tenantId, t.status),
    investorIdx: index("sips_investor_idx").on(t.tenantId, t.investorId),
    endDateIdx: index("sips_end_date_idx").on(t.tenantId, t.status, t.endDate),
    // Supports the daily-SIP report's `... WHERE created_at >= now() - interval`
    // (RLS adds the tenant_id predicate) which otherwise tenant-scans.
    createdIdx: index("sips_tenant_created_idx").on(t.tenantId, t.createdAt),
  })
);

export type Transaction = typeof transactions.$inferSelect;
export type Mandate = typeof mandates.$inferSelect;
export type Sip = typeof sips.$inferSelect;
