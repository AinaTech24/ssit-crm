import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single SIP-rejection record.
 *
 *   PATCH  /api/sip-rejections/[id]   — update recovery status / remarks / follow-up / recovery date
 *   DELETE /api/sip-rejections/[id]   — soft-archive (status='not_recoverable')
 *
 * Status changes stamp `statusChangedAt` so the 2-day escalation knows when
 * the clock last moved.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sipRejections, SIP_RECOVERY_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  recoveryStatus: z.enum(SIP_RECOVERY_STATUSES).optional(),
  followUpDate: z.string().optional(),
  recoveryDate: z.string().optional(),
  remarks: z.string().optional(),
  assignedRmId: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(sipRejections).where(and(eq(sipRejections.id, id), eq(sipRejections.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      const patch: any = { ...parse.data, updatedAt: new Date() };

      // Stamp statusChangedAt when status flips
      if (parse.data.recoveryStatus && parse.data.recoveryStatus !== before.recoveryStatus) {
        patch.statusChangedAt = new Date();
      }
      // Auto-set recoveryDate when status becomes 'recovered' and not provided
      if (
        parse.data.recoveryStatus === "recovered" &&
        !parse.data.recoveryDate &&
        !before.recoveryDate
      ) {
        patch.recoveryDate = new Date().toISOString().slice(0, 10);
      }

      await tx.update(sipRejections).set(patch).where(and(eq(sipRejections.id, id), eq(sipRejections.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sip_rejection.update",
        entityType: "sip_rejection",
        entityId: id,
        before: { recoveryStatus: before.recoveryStatus } as any,
        after: parse.data as any,
        ...clientMeta,
      });

      return { ok: true };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(sipRejections)
        .set({ recoveryStatus: "not_recoverable", statusChangedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(sipRejections.id, id), eq(sipRejections.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sip_rejection.close",
        entityType: "sip_rejection",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
