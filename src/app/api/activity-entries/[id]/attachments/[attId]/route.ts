import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/activity-entries/[id]/attachments/[attId] — soft-delete a task attachment
 * (and remove the S3 object). Allowed for the uploader or any task.edit.all user.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activityAttachments } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [a] = await tx
        .select()
        .from(activityAttachments)
        .where(and(eq(activityAttachments.id, attId), eq(activityAttachments.activityId, id), eq(activityAttachments.tenantId, session.tenantId)))
        .limit(1);
      if (!a) return "not_found" as const;
      if (!canEditAll && a.uploadedBy !== session.userId) return "forbidden" as const;
      if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
      await tx
        .update(activityAttachments)
        .set({ deletedAt: new Date() })
        .where(and(eq(activityAttachments.id, attId), eq(activityAttachments.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "activity.attachment.delete",
        entityType: "activity_entry",
        entityId: id,
        before: { attachmentId: attId, fileName: a.fileName },
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only delete attachments you uploaded" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
