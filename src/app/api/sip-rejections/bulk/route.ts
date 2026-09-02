import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/sip-rejections/bulk — apply one recovery action to many rejections.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"     value = rmId (uuid) | null   → reassign the recovery owner
 *          = "contacted"  (no value)                   → mark "client contacted"
 *          = "follow_up"  value = ISO date string      → set the follow-up date
 *          = "close"      (no value)                   → mark "not recoverable"
 *
 * Tenant isolation is enforced by RLS (withTenant sets app.tenant_id) — we scope
 * by id only, exactly like the single-record route and the investors/leads bulk
 * routes. A status change stamps status_changed_at so the 2-day SLA clock moves.
 * Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { sipRejections } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(["assign", "contacted", "follow_up", "close"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const patch: Record<string, any> = { updatedAt: new Date() };
    switch (action) {
      case "assign":
        patch.assignedRmId = value && value.length > 0 ? value : null;
        break;
      case "contacted":
        patch.recoveryStatus = "client_contacted";
        patch.statusChangedAt = new Date();
        break;
      case "follow_up":
        if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
        patch.followUpDate = value.slice(0, 10);
        break;
      case "close":
        patch.recoveryStatus = "not_recoverable";
        patch.statusChangedAt = new Date();
        break;
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      const updated = await tx
        .update(sipRejections)
        .set(patch as any)
        .where(inArray(sipRejections.id, ids))
        .returning({ id: sipRejections.id });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `sip_rejection.bulk_${action}`,
        entityType: "sip_rejection",
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
