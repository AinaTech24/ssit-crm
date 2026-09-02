import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/tasks/[id]/restore — recover a soft-deleted task from Trash
 * (clears deleted_at). Same RBAC as edit/delete: task.edit.all restores any
 * task; task.edit.assigned may only restore their own.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId), isNotNull(tasks.deletedAt)))
        .limit(1);
      if (!before) return "not_found" as const;
      if (!canEditAll && before.assigneeId !== session.userId && before.createdById !== session.userId) {
        return "forbidden" as const;
      }
      await tx
        .update(tasks)
        .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() } as any)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.restore",
        entityType: "task",
        entityId: id,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found in trash" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only restore your own tasks" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
