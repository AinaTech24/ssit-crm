/**
 * Firm business-finance tables — Network FP Module 8 (the MFD's *own*
 * books, not client portfolios).
 *
 *   business_expenses — line-item expense ledger (8.2). Income lives in
 *                       commission_records / amc_payouts; together they feed
 *                       the firm P&L (8.3).
 *   business_targets  — firm-level annual targets per metric per FY (8.5).
 *                       Actuals are computed from investors / leads / meetings
 *                       / transactions; this table only stores the goal.
 *
 * Both are tenant-scoped — added to tenant_tables in the RLS migration.
 */

import { boolean, date, index, integer, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/** Expense categories — mirror the Network FP 8.1 / 8.3 expense heads. */
export const EXPENSE_CATEGORIES = [
  "office_rent",
  "team_salaries",
  "team_welfare",
  "utilities",
  "travel",
  "tech",
  "knowledge",
  "marketing",
  "gst",
  "others",
] as const;

export const PAID_FROM = [
  "current_account",
  "savings_account",
  "credit_card",
  "cash",
  "other",
] as const;

export const businessExpenses = pgTable(
  "business_expenses",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    expenseDate: date("expense_date").notNull(),
    description: text("description").notNull(),
    category: text("category", { enum: EXPENSE_CATEGORIES }).notNull().default("others"),
    paidFrom: text("paid_from", { enum: PAID_FROM }).notNull().default("current_account"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    notes: text("notes"),
    /** When this row was auto-posted from a recurring template, these link it
     *  back so the same template can't post twice in one month. */
    recurringId: uuid("recurring_id"),
    recurringPeriod: text("recurring_period"), // 'YYYY-MM'
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    dateIdx: index("business_expenses_date_idx").on(t.tenantId, t.expenseDate),
    categoryIdx: index("business_expenses_category_idx").on(t.tenantId, t.category),
  })
);

/** Recurring expense templates — fixed monthly costs posted to the ledger with
 *  one click each month (rent, salaries, software subscriptions). */
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    description: text("description").notNull(),
    category: text("category", { enum: EXPENSE_CATEGORIES }).notNull().default("others"),
    paidFrom: text("paid_from", { enum: PAID_FROM }).notNull().default("current_account"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    dayOfMonth: integer("day_of_month").notNull().default(1),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index("recurring_expenses_tenant_idx").on(t.tenantId),
  })
);

/** Per-category monthly expense budgets — drive the budget-vs-actual view. */
export const expenseBudgets = pgTable(
  "expense_budgets",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    category: text("category", { enum: EXPENSE_CATEGORIES }).notNull(),
    monthlyBudget: numeric("monthly_budget", { precision: 18, scale: 2 }).notNull().default("0"),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    uniqueCell: uniqueIndex("expense_budgets_unique").on(t.tenantId, t.category),
  })
);

/** Firm-level annual progress targets — one row per (tenant × FY × metric). */
export const TARGET_METRICS = [
  "new_clients",
  "leads_generated",
  "meetings_done",
  "aum_addition",
  "sip_book_addition",
  "lumpsum_added",
] as const;

export const businessTargets = pgTable(
  "business_targets",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    fiscalYear: text("fiscal_year").notNull(), // 'YYYY-YY' e.g. '2025-26'
    metric: text("metric", { enum: TARGET_METRICS }).notNull(),
    annualTarget: numeric("annual_target", { precision: 18, scale: 2 }).notNull().default("0"),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    uniqueCell: uniqueIndex("business_targets_unique").on(t.tenantId, t.fiscalYear, t.metric),
    fyIdx: index("business_targets_fy_idx").on(t.tenantId, t.fiscalYear),
  })
);

export type BusinessExpense = typeof businessExpenses.$inferSelect;
export type NewBusinessExpense = typeof businessExpenses.$inferInsert;
export type BusinessTarget = typeof businessTargets.$inferSelect;
export type NewBusinessTarget = typeof businessTargets.$inferInsert;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;
export type ExpenseBudget = typeof expenseBudgets.$inferSelect;
export type NewExpenseBudget = typeof expenseBudgets.$inferInsert;
