/**
 * Load a tenant's leave entitlements (annual days per type), merged over the
 * built-in defaults. Returns null when no settings row exists (callers then fall
 * back to LEAVE_ENTITLEMENTS via getEntitlement).
 */
import { eq } from "drizzle-orm";
import { leaveSettings } from "@/db/schema";
import { LEAVE_ENTITLEMENTS } from "./policy";

type Tx = { select: any };

export async function loadLeaveEntitlements(tx: Tx, tenantId: string): Promise<Record<string, number | null>> {
  const row = (await tx.select().from(leaveSettings).where(eq(leaveSettings.tenantId, tenantId)).limit(1))[0];
  const tenant = (row?.entitlements ?? {}) as Record<string, number | null>;
  // Defaults overlaid with the firm's configured values.
  return { ...LEAVE_ENTITLEMENTS, ...tenant };
}
