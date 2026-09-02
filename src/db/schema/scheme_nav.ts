import { date, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Latest NAV per mutual-fund scheme — PLATFORM-SHARED market data, NOT
 * tenant-scoped (NAV is universal; every MFD values the same HDFC Flexi Cap
 * with the same number). Like `recipes` / `packages` / `content_library_assets`
 * this table has NO tenant_id and therefore NO RLS policy — it's reference data
 * read by every tenant. (The RLS CI guard only checks tables that HAVE a
 * tenant_id, so this is correctly ignored there.)
 *
 * Populated daily from AMFI's public NAVAll feed (see src/lib/finance/nav-feed.ts).
 * Keyed by the AMFI scheme code, which is what folios/transactions store in
 * `scheme_code`, so valuation is a simple join.
 */
export const schemeNav = pgTable(
  "scheme_nav",
  {
    /** AMFI scheme code, e.g. "119551". Primary key — one row per scheme. */
    schemeCode: text("scheme_code").primaryKey(),
    /** ISIN for the Payout/Growth plan (AMFI col 1). */
    isin: text("isin"),
    /** ISIN for the Dividend-Reinvestment plan (AMFI col 2) — kept distinct so
     *  RTA/folio matching can resolve a holding carrying either ISIN. */
    isinReinvest: text("isin_reinvest"),
    schemeName: text("scheme_name").notNull(),
    amcName: text("amc_name"),
    /** Scheme structure from the AMFI section header: "Open Ended" / "Close
     *  Ended" / "Interval". */
    schemeType: text("scheme_type"),
    /** Granular AMFI category from the section header, e.g.
     *  "Equity Scheme - Flexi Cap Fund". Authoritative for the WHOLE universe
     *  (unlike the mfapi join, which is gappy). */
    schemeCategory: text("scheme_category"),
    /** Latest published NAV (₹ per unit). */
    nav: numeric("nav", { precision: 14, scale: 4 }).notNull(),
    /** Date the NAV was published by the AMC/AMFI. */
    navDate: date("nav_date").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    isinIdx: index("scheme_nav_isin_idx").on(t.isin),
    nameIdx: index("scheme_nav_name_idx").on(t.schemeName),
  })
);

export type SchemeNav = typeof schemeNav.$inferSelect;
export type NewSchemeNav = typeof schemeNav.$inferInsert;
