import { date, index, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";

export const folios = pgTable(
  "folios",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    folioNumber: text("folio_number").notNull(),
    amcCode: text("amc_code").notNull(),
    amcName: text("amc_name").notNull(),
    rta: text("rta", { enum: ["cams", "kfintech", "sundaram", "franklin", "other"] }),
    openedAt: date("opened_at"),
    closedAt: date("closed_at"),
    aum: numeric("aum", { precision: 18, scale: 2 }).default("0"),
    schemes: jsonb("schemes").$type<Array<{
      schemeCode: string;
      schemeName: string;
      /** ISIN (when the RTA file carried it) — kept so holdings can be
       *  re-resolved / re-priced against the AMFI master by ISIN later. */
      isin?: string;
      category?: string;
      units?: number;
      nav?: number;
      value?: number;
    }>>(),
    /** Extra folio attributes captured on import (holding mode, status, bank,
     *  nominee, invested/current value, XIRR, units, SIP flag …) without needing
     *  a dedicated column each. */
    details: jsonb("details").$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (t) => ({
    folioUnique: uniqueIndex("folios_tenant_amc_folio_unique").on(t.tenantId, t.amcCode, t.folioNumber),
    investorIdx: index("folios_investor_idx").on(t.tenantId, t.investorId),
    // Lookup by folio without amc_code — the RTA-import resolution hot path.
    folioNumberIdx: index("folios_tenant_folio_idx").on(t.tenantId, t.folioNumber),
  })
);

export type Folio = typeof folios.$inferSelect;
export type NewFolio = typeof folios.$inferInsert;
