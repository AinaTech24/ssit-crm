import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/tasks/[id]/comments/[commentId] — soft-delete a task comment.
 * Allowed for the comment's author or any task.edit.all user (owner).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { taskComments } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const { id, commentId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [c] = await tx
        .select({ authorId: taskComments.authorId })
        .from(taskComments)
        .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, id), eq(taskComments.tenantId, session.tenantId)))
        .limit(1);
      if (!c) return "not_found" as const;
      if (!canEditAll && c.authorId !== session.userId) return "forbidden" as const;
      await tx
        .update(taskComments)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(taskComments.id, commentId), eq(taskComments.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.comment.delete",
        entityType: "task",
        entityId: id,
        after: { commentId } as any,
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only delete your own comments" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
