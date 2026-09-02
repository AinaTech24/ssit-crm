import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/reconciliation/exceptions/[id]
 *   Update a reconciliation break: status (investigating | resolved | ignored
 *   | open) and/or a note. Resolving stamps resolved_at + resolved_by.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reconciliationExceptions } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  status: z.enum(["open", "investigating", "resolved", "ignored"]).optional(),
  notes: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { status, notes } = parse.data;
    if (status === undefined && notes === undefined) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const [row] = await tx
          .select()
          .from(reconciliationExceptions)
          .where(and(eq(reconciliationExceptions.id, id), eq(reconciliationExceptions.tenantId, session.tenantId)))
          .limit(1);
        if (!row) return null;

        const patch: any = { updatedAt: new Date() };
        if (notes !== undefined) patch.notes = notes;
        if (status !== undefined) {
          patch.status = status;
          if (status === "resolved") {
            patch.resolvedAt = new Date();
            patch.resolvedBy = session.userId;
          } else {
            patch.resolvedAt = null;
            patch.resolvedBy = null;
          }
        }
        await tx
          .update(reconciliationExceptions)
          .set(patch)
          .where(and(eq(reconciliationExceptions.id, id), eq(reconciliationExceptions.tenantId, session.tenantId)));

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "reconciliation.exception.update",
          entityType: "reconciliation_exception",
          entityId: id,
          after: { status, notes },
          ...clientMetaFromHeaders(req.headers),
        });
        return { ok: true };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
