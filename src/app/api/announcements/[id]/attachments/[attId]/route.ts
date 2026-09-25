import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/announcements/[id]/attachments/[attId] — soft-delete an
 * announcement attachment and remove the S3 object. Owner / branch head only,
 * the same gate as posting the notice.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { announcementAttachments } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";
import { isAnnouncementManager as isManager } from "@/lib/announcements/access";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) {
      return NextResponse.json(
        { error: "only owners / branch heads can remove an announcement's files" },
        { status: 403 }
      );
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [a] = await tx
        .select()
        .from(announcementAttachments)
        .where(
          and(
            eq(announcementAttachments.id, attId),
            eq(announcementAttachments.announcementId, id),
            eq(announcementAttachments.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!a) return "not_found" as const;
      if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
      await tx
        .update(announcementAttachments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(announcementAttachments.id, attId),
            eq(announcementAttachments.tenantId, session.tenantId)
          )
        );
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "announcement.attachment.delete",
        entityType: "announcement",
        entityId: id,
        before: { attachmentId: attId, fileName: a.fileName },
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
