import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/business-targets — upsert one firm annual target cell
 *   Body: { fiscalYear: 'YYYY-YY', metric, annualTarget }
 *
 * Gated by reports.commission. Tenant-scoped. Idempotent on
 * (tenant, fiscalYear, metric).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { businessTargets, TARGET_METRICS } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  fiscalYear: z.string().regex(/^\d{4}-\d{2}$/),
  metric: z.enum(TARGET_METRICS),
  annualTarget: z.number().min(0).max(1_000_000_000_000),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.commission", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const d = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const row = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(businessTargets)
        .where(
          and(
            eq(businessTargets.tenantId, session.tenantId),
            eq(businessTargets.fiscalYear, d.fiscalYear),
            eq(businessTargets.metric, d.metric)
          )
        )
        .limit(1);

      if (existing) {
        const [next] = await tx
          .update(businessTargets)
          .set({ annualTarget: String(d.annualTarget), updatedBy: session.userId, updatedAt: new Date() } as any)
          .where(eq(businessTargets.id, existing.id))
          .returning();
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "business_target.update",
          entityType: "business_target",
          entityId: existing.id,
          before: existing as any,
          after: next as any,
          ...meta,
        });
        return next;
      }

      const [created] = await tx
        .insert(businessTargets)
        .values({
          tenantId: session.tenantId,
          fiscalYear: d.fiscalYear,
          metric: d.metric,
          annualTarget: String(d.annualTarget),
          updatedBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_target.create",
        entityType: "business_target",
        entityId: created.id,
        after: created as any,
        ...meta,
      });
      return created;
    });

    return NextResponse.json({ target: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
