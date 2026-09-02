import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/tech-stack/[id] — remove a tool from the register.
 * Gated by reports.commission. Tenant-scoped via withTenant + RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { techStackTools } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.commission", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const ok = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(techStackTools)
        .where(and(eq(techStackTools.id, id), eq(techStackTools.tenantId, session.tenantId)))
        .limit(1);
      if (!existing) return false;
      await tx.delete(techStackTools).where(eq(techStackTools.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "tech_stack.delete",
        entityType: "tech_stack_tool",
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
