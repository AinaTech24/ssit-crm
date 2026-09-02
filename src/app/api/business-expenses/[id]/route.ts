import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/business-expenses/[id] — remove an expense ledger line.
 * Gated by reports.commission. Tenant-scoped via withTenant + RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { businessExpenses } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "finances.view", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const ok = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(businessExpenses)
        .where(and(eq(businessExpenses.id, id), eq(businessExpenses.tenantId, session.tenantId)))
        .limit(1);
      if (!existing) return false;
      await tx
        .delete(businessExpenses)
        .where(and(eq(businessExpenses.id, id), eq(businessExpenses.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_expense.delete",
        entityType: "business_expense",
        entityId: id,
        before: existing as any,
        ...meta,
      });
      return true;
    });

    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
