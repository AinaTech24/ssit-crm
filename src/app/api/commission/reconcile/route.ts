import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/commission/reconcile  Body: { period: 'YYYY-MM' }
 *
 * Runs the reconciler for one period in this tenant. Owner / compliance only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reconcilePeriod } from "@/lib/commission/reconciler";

export const dynamic = "force-dynamic";

const Body = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
  varianceThresholdPct: z.number().min(0).max(1).default(0.02),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.commission", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await reconcilePeriod(tx, session.tenantId, parse.data.period, parse.data.varianceThresholdPct);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "transaction.reconcile",
        entityType: "commission_period",
        entityId: null,
        meta: { period: parse.data.period, threshold: parse.data.varianceThresholdPct, result: r },
        ...clientMeta,
      });
      return r;
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
