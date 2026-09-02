import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/schemes/[id]/evaluation
 *
 * Set/update the IC scorecard snapshot on a scheme — Network FP "3.3
 * MF Selection" parity. Stamped with evaluatedBy + evaluatedAt server-
 * side so we always know who ran the scorecard.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { schemeMaster } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const EvalBody = z.object({
  fundCategoryNote: z.string().max(500).optional(),
  fundObjective: z.string().max(500).optional(),
  schemeRiskProfile: z
    .enum(["low", "moderate", "high", "very_high"])
    .optional(),
  fmName: z.string().max(120).optional(),
  fmExperienceYears: z.number().min(0).max(60).optional(),
  amcReputationNote: z.string().max(500).optional(),
  fiveYearCagrPct: z.number().min(-100).max(100).optional(),
  consistencyPct: z.number().min(0).max(100).optional(),
  sharpeRatio: z.number().min(-10).max(20).optional(),
  stdDevPct: z.number().min(0).max(100).optional(),
  expenseRatioPct: z.number().min(0).max(5).optional(),
  portfolioCompositionNote: z.string().max(1000).optional(),
  aumCrore: z.number().min(0).max(1000000).optional(),
  liquidityNote: z.string().max(500).optional(),
  verdict: z.enum(["pass", "watch", "reject"]).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const parse = EvalBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const evaluation = {
      ...parse.data,
      evaluatedAt: new Date().toISOString(),
      evaluatedBy: session.userId,
    };

    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schemeMaster)
        .where(
          and(
            eq(schemeMaster.id, id),
            eq(schemeMaster.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!existing) return null;
      const [next] = await tx
        .update(schemeMaster)
        .set({ evaluation: evaluation as any, updatedAt: new Date() } as any)
        .where(eq(schemeMaster.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "scheme.evaluation_update",
        entityType: "scheme",
        entityId: id,
        before: existing.evaluation as any,
        after: evaluation as any,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ scheme: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
