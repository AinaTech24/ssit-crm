import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/restore — recover a soft-deleted client from the
 * Trash bin (clears deleted_at). All related data was preserved while it sat in
 * the bin, so the client comes back intact. Gated on the same narrow
 * `investor.delete` capability that put it there.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { investors, auditLog } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.delete", session.permissions);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const restored = await tx
        .update(investors)
        .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() } as any)
        .where(
          and(
            eq(investors.id, id),
            eq(investors.tenantId, session.tenantId),
            isNotNull(investors.deletedAt)
          )
        )
        .returning({ id: investors.id, name: investors.name });
      if (!restored.length) return "not_found" as const;
      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.restore",
        entityType: "investor",
        entityId: id,
        after: { name: restored[0].name } as any,
      } as any);
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
