/**
 * mf_schemes — platform-shared Mutual Fund SCHEME CATALOG, sourced daily from
 * the public mfapi.in API (https://api.mfapi.in/mf). NOT tenant-scoped: every
 * MFD tenant reads the same catalog; only the system/cron writes it (RLS:
 * read-all, write platform-admin only — see 0088_mf_schemes.sql).
 *
 * Complements `scheme_nav` (AMFI latest-NAV feed). This table adds scheme
 * discovery metadata (fund house, scheme type, category) + a cached latest NAV,
 * and powers the scheme/AMC autocomplete used wherever a scheme is referenced.
 */

import { boolean, date, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const mfSchemes = pgTable(
  "mf_schemes",
  {
    /** mfapi.in scheme code (== AMFI scheme code). */
    schemeCode: text("scheme_code").primaryKey(),
    schemeName: text("scheme_name").notNull(),
    /** AMC / fund house (e.g. "HDFC Mutual Fund"). Filled by the enrich pass. */
    fundHouse: text("fund_house"),
    schemeType: text("scheme_type"), // "Open Ended" / "Close Ended" …
    schemeCategory: text("scheme_category"), // "Equity Scheme - Large Cap" …
    isin: text("isin"),
    /** Latest NAV cached from mfapi (₹). Nullable until the enrich pass runs. */
    nav: numeric("nav", { precision: 14, scale: 4 }),
    navDate: date("nav_date"),
    isActive: boolean("is_active").notNull().default(true),
    /** Last time scheme detail (house/type/category/nav) was pulled from mfapi. */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: index("mf_schemes_name_idx").on(t.schemeName),
    houseIdx: index("mf_schemes_house_idx").on(t.fundHouse),
    isinIdx: index("mf_schemes_isin_idx").on(t.isin),
  })
);

export type MfScheme = typeof mfSchemes.$inferSelect;
