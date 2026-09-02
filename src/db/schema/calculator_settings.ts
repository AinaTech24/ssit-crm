/**
 * Per-tenant calculator assumptions. Lets a firm set its house view for the
 * default expected return / inflation that calculators seed with, instead of
 * every advisor being locked to the hardcoded 12% / 6% / 10%. One row per
 * tenant, created lazily with sensible India defaults.
 */

import { numeric, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const calculatorSettings = pgTable(
  "calculator_settings",
  {
    id,
    tenantId,
    /** Default equity/blended expected return %, e.g. 12. */
    defaultReturnPct: numeric("default_return_pct").notNull().default("12"),
    /** Default general inflation %, e.g. 6. */
    defaultInflationPct: numeric("default_inflation_pct").notNull().default("6"),
    /** Education-specific inflation %, e.g. 10 (child-education calcs). */
    educationInflationPct: numeric("education_inflation_pct").notNull().default("10"),
    /** Conservative/debt return % for asset-allocation calcs, e.g. 7. */
    debtReturnPct: numeric("debt_return_pct").notNull().default("7"),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("calculator_settings_tenant_uq").on(t.tenantId),
  })
);

export type CalculatorSettings = typeof calculatorSettings.$inferSelect;
