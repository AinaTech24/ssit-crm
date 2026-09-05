import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/status
 * Body: { action: 'suspend' | 'activate', reason?: string }
 *
 * Switches a firm on or off. This is an OPERATIONAL action, not a billing one —
 * packages, trials and renewals were removed, so there is no license to extend
 * or subscription to cancel. The state lives on `tenants.status`, which is what
 * loadTenantLicense reads to decide `isRestricted`.
 *
 * Every action is still recorded in subscription_events for audit (that table is
 * the platform's tenant-event log; the name is historical).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform, type PlatformCapability } from "@/lib/auth/rbac";
import { subscriptions, subscriptionEvents, tenants } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["suspend", "activate"]),
  reason: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action, reason } = parse.data;

    const capForAction: Record<typeof action, PlatformCapability> = {
      suspend: "platform.tenant.suspend",
      activate: "platform.tenant.activate",
    };
    requirePlatform(session.roles, capForAction[action]);

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const [t] = await tx
        .select({ status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });

      const fromStatus = t.status;
      const newStatus = action === "suspend" ? "suspended" : "active";

      await tx
        .update(tenants)
        .set({ status: newStatus, updatedAt: new Date() } as any)
        .where(eq(tenants.id, tenantId));

      // Mirror the reason onto the access-override row when one exists, so the
      // restricted screen can explain WHY the firm is locked.
      const [sub] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId))
        .limit(1);
      if (sub) {
        await tx
          .update(subscriptions)
          .set(
            action === "suspend"
              ? { suspendedAt: new Date(), suspendedReason: reason ?? "Suspended by Equitywala", updatedAt: new Date() }
              : { suspendedAt: null, suspendedReason: null, updatedAt: new Date() }
          )
          .where(eq(subscriptions.id, sub.id));

        await tx.insert(subscriptionEvents).values({
          subscriptionId: sub.id,
          tenantId,
          eventType: (action === "suspend" ? "suspended" : "reactivated") as any,
          actor: `ssit_admin:${session.userId}`,
          fromStatus,
          toStatus: newStatus,
          notes: reason,
        } as any);
      }

      return { ok: true, action, newStatus };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
