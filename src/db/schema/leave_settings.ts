/**
 * Per-tenant leave policy — annual entitlement (days) per leave type, so each
 * firm sets its own policy instead of the hardcoded defaults. One row per tenant.
 * Per-employee overrides (users.customLeaveEntitlements) still take precedence.
 */
import { boolean, jsonb, numeric, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const leaveSettings = pgTable(
  "leave_settings",
  {
    id,
    tenantId,
    /** { casual: 12, sick: 6, earned: 15, comp_off: 0, unpaid: null, other: null } */
    entitlements: jsonb("entitlements").$type<Record<string, number | null>>().notNull().default({}),
    /** Paid-leave days per FY, shared across casual/sick/earned (migration 0204). */
    annualTotal: numeric("annual_total", { precision: 5, scale: 1 }).notNull().default("18"),
    /** Days earned per completed month of the FY, capped at annualTotal. */
    monthlyAccrual: numeric("monthly_accrual", { precision: 4, scale: 2 }).notNull().default("1.5"),
    /** Whether unused earned leave carries forward to the next FY (informational + future accrual). */
    carryForwardEarned: boolean("carry_forward_earned").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("leave_settings_tenant_uq").on(t.tenantId),
  })
);

export type LeaveSettings = typeof leaveSettings.$inferSelect;
