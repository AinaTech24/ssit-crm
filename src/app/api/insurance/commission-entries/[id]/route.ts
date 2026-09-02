import { handleApiError } from "@/lib/api/error-handler";
/** DELETE /api/insurance/commission-entries/[id] — remove a commission entry. */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { insuranceCommissionEntries } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const ok = await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(insuranceCommissionEntries).where(and(eq(insuranceCommissionEntries.id, id), eq(insuranceCommissionEntries.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!before) return false;
      await tx.delete(insuranceCommissionEntries).where(and(eq(insuranceCommissionEntries.id, id), eq(insuranceCommissionEntries.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance_commission.delete",
        entityType: "insurance_commission_entry",
        entityId: id,
        before: { insurer: before.insurer, netAmount: before.netAmount } as any,
        ...clientMeta,
      });
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
