import { date, index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";

/**
 * Direct-Equity (broking) module — the firm's equity desk, separate from the
 * mutual-fund book. Powers the "Equity Team" MIS (Brokerage · New DMAT · Active
 * Clients — Planned vs Actual vs MoM). Targets live in annual_targets
 * (metric 'equity_brokerage' / 'equity_new_dmat' / 'equity_active_clients').
 */

export const DMAT_STATUSES = ["active", "dormant", "closed"] as const;

/** One row per DMAT/trading account. New-DMAT and Active-Client counts compute
 *  from opened_date / closed_date, so any month-end can be derived historically. */
export const equityDmatAccounts = pgTable(
  "equity_dmat_accounts",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").references(() => investors.id),
    clientName: text("client_name").notNull(),
    dmatNumber: text("dmat_number"),
    broker: text("broker"),
    rmId: uuid("rm_id").references(() => users.id),
    openedDate: date("opened_date").notNull(),
    closedDate: date("closed_date"),
    status: text("status", { enum: DMAT_STATUSES }).notNull().default("active"),
    ...timestamps,
  },
  (t) => ({
    openedIdx: index("equity_dmat_opened_idx").on(t.tenantId, t.openedDate),
    statusIdx: index("equity_dmat_status_idx").on(t.tenantId, t.status),
  })
);

/** Monthly brokerage earned by the equity desk (one figure per month). */
export const equityBrokerage = pgTable(
  "equity_brokerage",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    period: text("period").notNull(), // 'YYYY-MM'
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    periodUnique: uniqueIndex("equity_brokerage_period_unique").on(t.tenantId, t.period),
  })
);

export type EquityDmatAccount = typeof equityDmatAccounts.$inferSelect;
export type EquityBrokerage = typeof equityBrokerage.$inferSelect;
