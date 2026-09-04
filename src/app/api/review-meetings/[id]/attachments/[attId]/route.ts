import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/review-meetings/[id]/attachments/[attId] — soft-delete a meeting
 * attachment and remove the stored object. Allowed for the uploader, or for any
 * user holding review_meeting.manage.all.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reviewMeetingAttachments } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> }
) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [a] = await tx
        .select()
        .from(reviewMeetingAttachments)
        .where(
          and(
            eq(reviewMeetingAttachments.id, attId),
            eq(reviewMeetingAttachments.meetingId, id),
            eq(reviewMeetingAttachments.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!a) return "not_found" as const;
      if (!canAll && a.uploadedBy !== session.userId) return "forbidden" as const;

      if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
      await tx
        .update(reviewMeetingAttachments)
        .set({ deletedAt: new Date() } as any)
        .where(
          and(
            eq(reviewMeetingAttachments.id, attId),
            eq(reviewMeetingAttachments.tenantId, session.tenantId)
          )
        );
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.attachment.delete",
        entityType: "review_meeting",
        entityId: id,
        before: { attachmentId: attId, fileName: a.fileName } as any,
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") {
      return NextResponse.json({ error: "you can only delete attachments you uploaded" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
