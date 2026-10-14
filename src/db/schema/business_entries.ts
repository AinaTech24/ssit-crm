/**
 * Business Closing Entries — a manual ledger of business booked with a client
 * across product types (Mutual Fund / PMS / AIF / SIF / …). Each entry is a
 * header + a sub-form of scheme line items (Zoho-style), every line with its own
 * amount, transaction type (SIP/Lumpsum/Switch/STP/SWP/…) and asset class.
 *
 * Powers: client confirmation emails, the business dashboard, and the
 * "Liquid-for-switching" report (how much each client has parked in liquid,
 * ready to deploy into equity on a market dip).
 */

import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";

export const PRODUCT_TYPES = ["mutual_fund", "direct_equity", "pms", "aif", "sif", "bond", "ncd", "p2p", "las", "other"] as const;
export const BUSINESS_ENTRY_STATUSES = ["draft", "confirmed", "emailed", "cancelled"] as const;
export const TXN_TYPES = ["sip", "sip_topup", "sip_stop", "lumpsum", "additional_purchase", "switch", "stp", "swp", "redemption", "other"] as const;
export const TXN_FREQUENCIES = ["one_time", "weekly", "monthly", "quarterly", "half_yearly", "yearly"] as const;
/** Normalised asset bucket (derived from the master scheme category). */
export const ASSET_CLASSES = ["equity", "debt", "liquid", "hybrid", "gold", "other"] as const;

export const businessEntries = pgTable(
  "business_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** The client this business is for. */
    investorId: uuid("investor_id").references(() => investors.id),
    /** Denormalised client name (kept even if the master is renamed/merged). */
    clientName: text("client_name").notNull(),

    productType: text("product_type", { enum: PRODUCT_TYPES }).notNull().default("mutual_fund"),
    /** Execution venue / distribution platform (Finowise MIS) — e.g. NJ, Motilal
     *  Oswal, Piper Serica, Anand Rathi, Phillip Capital, Advisorkhoj, AK Capital. */
    platform: text("platform"),
    /** Business / closing date. */
    businessDate: date("business_date").notNull(),
    status: text("status", { enum: BUSINESS_ENTRY_STATUSES }).notNull().default("draft"),

    /** RM who closed the business (defaults to the creator). */
    rmId: uuid("rm_id").references(() => users.id),
    /** Team member who executed the transaction (may differ from the RM). */
    executedById: uuid("executed_by_id").references(() => users.id),
    amcName: text("amc_name"),
    folioNo: text("folio_no"),

    /** Denormalised gross of all line amounts — fast list + KPI reads. */
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Per-asset-class gross, e.g. { equity, debt, liquid, hybrid, … } — fast dashboard. */
    assetBreakup: jsonb("asset_breakup").$type<Record<string, number>>(),
    /** Net into liquid via this entry (liquid-in − liquid-out) — fast liquid report. */
    liquidNet: numeric("liquid_net", { precision: 18, scale: 2 }).notNull().default("0"),

    notes: text("notes"),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    tenantDateIdx: index("business_entries_tenant_date_idx").on(t.tenantId, t.businessDate),
    investorIdx: index("business_entries_investor_idx").on(t.tenantId, t.investorId),
    rmIdx: index("business_entries_rm_idx").on(t.tenantId, t.rmId),
    statusIdx: index("business_entries_status_idx").on(t.tenantId, t.status),
  })
);

export const businessEntryLines = pgTable(
  "business_entry_lines",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => businessEntries.id, { onDelete: "cascade" }),

    /** mf_schemes code when picked from the catalog; null for free-typed (PMS/AIF). */
    schemeCode: text("scheme_code"),
    schemeName: text("scheme_name").notNull(),
    amcName: text("amc_name"),
    /** Raw category from the scheme master, e.g. "Equity Scheme - Large Cap". */
    assetCategory: text("asset_category"),
    /** Normalised bucket derived from assetCategory (drives reports). */
    assetClass: text("asset_class", { enum: ASSET_CLASSES }).notNull().default("other"),

    txnType: text("txn_type", { enum: TXN_TYPES }).notNull().default("lumpsum"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
    units: numeric("units", { precision: 18, scale: 4 }),
    /** For SIP / STP / SWP. */
    frequency: text("frequency", { enum: TXN_FREQUENCIES }),
    /** Recurring SIP installment day / ECS date — day of month "1".."28".
     *  Carried onto the auto-created sips row so reminder workflows can fire. */
    sipDate: text("sip_date"),

    /** Source scheme for a switch / STP / SWP (money moving OUT of this). */
    fromSchemeCode: text("from_scheme_code"),
    fromSchemeName: text("from_scheme_name"),
    fromAssetClass: text("from_asset_class", { enum: ASSET_CLASSES }),

    folioNo: text("folio_no"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    entryIdx: index("business_entry_lines_entry_idx").on(t.entryId, t.sortOrder),
    tenantClassIdx: index("business_entry_lines_class_idx").on(t.tenantId, t.assetClass),
  })
);

export type BusinessEntry = typeof businessEntries.$inferSelect;
export type BusinessEntryLine = typeof businessEntryLines.$inferSelect;
