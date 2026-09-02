import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/proposals/bulk — apply one action to many proposals at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "delete" → soft delete (status='rejected', rejection_reason='deleted'),
 *            matching the single-record DELETE which rejects rather than purges.
 *
 * RBAC: proposal.write. Tenant isolation via withTenant + an explicit tenant
 * predicate on the UPDATE.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { proposals } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["delete"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const count = await withTenant(session.tenantId, async (tx) => {
      const upd = await tx
        .update(proposals)
        .set({
          status: "rejected",
          rejectionReason: "deleted",
          rejectedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(proposals.tenantId, session.tenantId), inArray(proposals.id, ids)))
        .returning({ id: proposals.id });

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `proposal.bulk_${action}`,
        entityType: "proposal",
        entityId: ids[0],
        after: { ids, action, count: upd.length } as any,
        ...meta,
      }).catch(() => {});

      return upd.length;
    });

    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
