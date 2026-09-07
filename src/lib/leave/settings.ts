/**
 * Load a tenant's leave policy — the accruing pool (annual total + monthly
 * accrual) plus the per-type entitlements that sit OUTSIDE the pool, merged
 * over the built-in defaults.
 */
import { eq } from "drizzle-orm";
import { leaveSettings } from "@/db/schema";
import { LEAVE_ENTITLEMENTS, LEAVE_ANNUAL_TOTAL, LEAVE_MONTHLY_ACCRUAL } from "./policy";

type Tx = { select: any };

export type LeavePolicy = {
  entitlements: Record<string, number | null>;
  annualTotal: number;
  monthlyAccrual: number;
  carryForwardEarned: boolean;
};

/** numeric() comes back from pg as a string; null when the firm has no row. */
function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadLeavePolicy(tx: Tx, tenantId: string): Promise<LeavePolicy> {
  const row = (await tx.select().from(leaveSettings).where(eq(leaveSettings.tenantId, tenantId)).limit(1))[0];
  const tenant = (row?.entitlements ?? {}) as Record<string, number | null>;
  return {
    // Defaults overlaid with the firm's configured values.
    entitlements: { ...LEAVE_ENTITLEMENTS, ...tenant },
    annualTotal: num(row?.annualTotal, LEAVE_ANNUAL_TOTAL),
    monthlyAccrual: num(row?.monthlyAccrual, LEAVE_MONTHLY_ACCRUAL),
    carryForwardEarned: Boolean(row?.carryForwardEarned),
  };
}

/**
 * Entitlements only. Kept because several callers want just the per-type map;
 * prefer loadLeavePolicy when the pool numbers are needed too.
 */
export async function loadLeaveEntitlements(tx: Tx, tenantId: string): Promise<Record<string, number | null>> {
  return (await loadLeavePolicy(tx, tenantId)).entitlements;
}
