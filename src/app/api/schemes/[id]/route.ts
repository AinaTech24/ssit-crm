import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single scheme — metadata edit.
 *
 *   PATCH /api/schemes/[id]  — edit catalog metadata (category, plan, exit
 *                              load, risk, status). IC / compliance only.
 *
 * Shortlist is handled by /api/scheme-shortlist; evaluation by
 * /api/schemes/[id]/evaluation.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { schemeMaster } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  schemeName: z.string().min(2).max(300).optional(),
  category: z.string().max(120).nullable().optional(),
  subCategory: z.string().max(120).nullable().optional(),
  coarseCategory: z.enum(["equity", "hybrid", "debt", "liquid", "commodity", "international", "other"]).nullable().optional(),
  plan: z.enum(["regular", "direct"]).nullable().optional(),
  option: z.enum(["growth", "idcw_payout", "idcw_reinvest"]).nullable().optional(),
  minInvestment: z.string().max(40).nullable().optional(),
  minSip: z.string().max(40).nullable().optional(),
  exitLoad: z.string().max(200).nullable().optional(),
  riskCategory: z.string().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
  isClosed: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(schemeMaster).where(and(eq(schemeMaster.id, id), eq(schemeMaster.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;
      const next = await tx
        .update(schemeMaster)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(and(eq(schemeMaster.id, id), eq(schemeMaster.tenantId, session.tenantId)))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "scheme.update",
        entityType: "scheme",
        entityId: id,
        after: parse.data as any,
        ...meta,
      });
      return next[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ scheme: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
