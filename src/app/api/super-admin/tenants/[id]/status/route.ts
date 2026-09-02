import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/status
 * Body: { action: 'suspend' | 'activate' | 'extend' | 'cancel', reason?: string, extendDays?: number }
 *
 * Changes a tenant's subscription status. Every action is recorded in
 * subscription_events for audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform, type PlatformCapability } from "@/lib/auth/rbac";
import { subscriptions, subscriptionEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["suspend", "activate", "extend", "cancel"]),
  reason: z.string().optional(),
  extendDays: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action, reason, extendDays } = parse.data;

    // Match the action to a specific platform capability (the spec
    // distinguishes "Suspend license" vs "Activate license" etc.)
    const capForAction: Record<typeof action, PlatformCapability> = {
      suspend: "platform.tenant.suspend",
      activate: "platform.tenant.activate",
      extend: "platform.license.assign",
      cancel: "platform.tenant.suspend",
    };
    requirePlatform(session.roles, capForAction[action]);

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const sub = (
        await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1)
      )[0];
      if (!sub) throw Object.assign(new Error("subscription not found"), { status: 404 });

      const fromStatus = sub.status;
      const patch: any = { updatedAt: new Date() };
      let eventType: string = "";

      switch (action) {
        case "suspend":
          patch.status = "suspended";
          patch.suspendedAt = new Date();
          patch.suspendedReason = reason ?? "Suspended by SSIT";
          eventType = "suspended";
          break;
        case "activate": {
          patch.status = "active";
          patch.suspendedAt = null;
          patch.suspendedReason = null;
          patch.cancelledAt = null;
          patch.cancelledReason = null;
          // Reactivation must restore a USABLE window — if the licence end is
          // missing or already past, grant a 30-day grace so the tenant can use
          // the app immediately (the admin can extend further). Without this,
          // "activate" sets status=active but the past licence-end makes the
          // gate re-derive "expired" → still locked out.
          const endMs = sub.licenseEndAt ? new Date(sub.licenseEndAt).getTime() : 0;
          if (endMs < Date.now()) {
            const grace = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            patch.licenseEndAt = grace;
            patch.nextRenewalAt = grace;
          }
          eventType = "reactivated";
          break;
        }
        case "extend": {
          if (!extendDays) throw new Error("extendDays required");
          const ms = extendDays * 24 * 60 * 60 * 1000;
          // Extend from the LATER of the current licence/trial end or now, so
          // extending an already-lapsed licence starts the new window from today.
          const base = Math.max(
            sub.licenseEndAt ? new Date(sub.licenseEndAt).getTime() : 0,
            sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0,
            Date.now()
          );
          const newEnd = new Date(base + ms);
          patch.licenseEndAt = newEnd;
          patch.nextRenewalAt = newEnd;
          // For a trial, the gate reads trial_ends (NOT license_end) — so a
          // trial whose trial_ends has passed stays "expired" no matter how far
          // we push license_end. Bump trial_ends too so the extension actually
          // takes effect.
          if (sub.status === "trial") patch.trialEndsAt = newEnd;
          // If the licence had lapsed, bring it back so the tenant can use the app.
          if (["suspended", "cancelled", "past_due", "expired"].includes(sub.status as string)) {
            patch.status = "active";
            patch.suspendedAt = null;
            patch.suspendedReason = null;
            patch.cancelledAt = null;
            patch.cancelledReason = null;
          }
          eventType = "license_extended";
          break;
        }
        case "cancel":
          patch.status = "cancelled";
          patch.cancelledAt = new Date();
          patch.cancelledReason = reason ?? "Cancelled by SSIT";
          eventType = "cancelled";
          break;
      }

      await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        subscriptionId: sub.id,
        tenantId,
        eventType: eventType as any,
        actor: `ssit_admin:${session.userId}`,
        fromStatus,
        toStatus: patch.status ?? fromStatus,
        notes: reason,
        meta: extendDays ? { extendDays } : undefined,
      } as any);

      return { ok: true, action, newStatus: patch.status ?? fromStatus };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
