/**
 * Per-tenant leave policy — annual entitlement (days) per leave type, so each
 * firm sets its own policy instead of the hardcoded defaults. One row per tenant.
 * Per-employee overrides (users.customLeaveEntitlements) still take precedence.
 */
import { boolean, jsonb, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const leaveSettings = pgTable(
  "leave_settings",
  {
    id,
    tenantId,
    /** { casual: 12, sick: 6, earned: 15, comp_off: 0, unpaid: null, other: null } */
    entitlements: jsonb("entitlements").$type<Record<string, number | null>>().notNull().default({}),
    /** Whether unused earned leave carries forward to the next FY (informational + future accrual). */
    carryForwardEarned: boolean("carry_forward_earned").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("leave_settings_tenant_uq").on(t.tenantId),
  })
);

export type LeaveSettings = typeof leaveSettings.$inferSelect;
