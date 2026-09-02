/**
 * On-demand single-goal recompute.
 *
 *   POST /api/goals/[id]/recompute — re-derive progress / required-SIP / gap /
 *   status for ONE goal off live linked folios + active SIPs, instead of waiting
 *   for the 6:30 IST nightly job. Reuses recomputeOneGoal().
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { goals } from "@/db/schema";
import { recomputeOneGoal } from "@/lib/goal-planning/recompute";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "goal.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx
          .select()
          .from(goals)
          .where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId)))
          .limit(1)
      )[0];
      if (!before) return null;

      await recomputeOneGoal(tx, id);

      const goal = (
        await tx
          .select()
          .from(goals)
          .where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId)))
          .limit(1)
      )[0];

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.recompute",
        entityType: "goal",
        entityId: id,
        ...clientMeta,
      });

      return { ok: true, goal };
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
