import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/service-requests/bulk — apply one action to many tickets.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"  value = userId (uuid) | null   → reassign
 *          = "status"  value = status enum            → set status
 *          = "close"   (no value)                     → status='closed'
 *
 * Tenant isolation via RLS (withTenant); scoped by id only, like the
 * single-record + other bulk routes. Audited as one bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { serviceRequests } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"] as const;

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(["assign", "status", "close"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const now = new Date();
    const patch: Record<string, any> = { updatedAt: now };
    switch (action) {
      case "assign":
        patch.assignedToUserId = value && value.length > 0 ? value : null;
        break;
      case "status":
        if (!value || !(STATUSES as readonly string[]).includes(value)) {
          return NextResponse.json({ error: "invalid status" }, { status: 400 });
        }
        patch.status = value;
        if (value === "resolved" || value === "closed") patch.resolvedAt = now;
        break;
      case "close":
        patch.status = "closed";
        patch.resolvedAt = now;
        break;
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      const updated = await tx
        .update(serviceRequests)
        .set(patch as any)
        .where(inArray(serviceRequests.id, ids))
        .returning({ id: serviceRequests.id });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `service_request.bulk_${action}`,
        entityType: "service_request",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({ ok: true, updated: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
