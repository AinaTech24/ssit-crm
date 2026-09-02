import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/super-admin/tenants/[id]/recover
 *
 * Restores a soft-deleted tenant: clears deleted_at, restores the ARN (strips
 * the "_deleted_<ts>" suffix the soft-delete added; falls back to a "_restored"
 * suffix if the original ARN is now taken), and reactivates the subscription
 * with a usable grace window so the firm can log back in immediately.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { tenants, subscriptions, subscriptionEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.activate");

    const result = await withPlatformAdmin(session.userId, async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (!t) throw Object.assign(new Error("tenant not found"), { status: 404 });
      if (!(t as any).deletedAt) return { ok: true, alreadyActive: true };

      // Strip the "_deleted_<timestamp>" suffix to recover the original ARN.
      const currentArn = (t as any).arn ?? "";
      const baseArn = currentArn.replace(/_deleted_\d+$/i, "");
      // If another live tenant already holds the original ARN, keep it unique.
      let restoredArn = baseArn;
      if (baseArn) {
        const clash = await tx.execute(sql`
          SELECT 1 FROM tenants WHERE lower(arn) = lower(${baseArn}) AND id <> ${tenantId}::uuid AND deleted_at IS NULL LIMIT 1
        `);
        if (clash.rows.length) restoredArn = `${baseArn}_restored`;
      }

      await tx.execute(sql`
        UPDATE tenants
        SET deleted_at = NULL,
            deleted_by = NULL,
            arn = ${restoredArn || currentArn || null},
            updated_at = now()
        WHERE id = ${tenantId}::uuid
      `);

      // Reactivate the subscription with a 30-day grace window so the tenant is
      // immediately usable (the admin can extend further).
      const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1))[0];
      if (sub) {
        const fromStatus = sub.status;
        const grace = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const endMs = sub.licenseEndAt ? new Date(sub.licenseEndAt).getTime() : 0;
        await tx
          .update(subscriptions)
          .set({
            status: "active",
            cancelledAt: null,
            cancelledReason: null,
            suspendedAt: null,
            suspendedReason: null,
            ...(endMs < Date.now() ? { licenseEndAt: grace, nextRenewalAt: grace } : {}),
            updatedAt: new Date(),
          } as any)
          .where(eq(subscriptions.id, sub.id));
        await tx.insert(subscriptionEvents).values({
          subscriptionId: sub.id,
          tenantId,
          eventType: "reactivated" as any,
          actor: `ssit_admin:${session.userId}`,
          fromStatus,
          toStatus: "active",
          notes: "Tenant recovered from soft-delete by SSIT",
        } as any);
      }
      return { ok: true, arn: restoredArn };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
