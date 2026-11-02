import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/service-requests/[id]/attachments/[attId] — soft-delete an
 * attachment and remove the stored object. Allowed for the uploader, or for
 * anyone holding service_request.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { serviceRequestAttachments } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["service_request.manage", "service_request.create"], session.permissions);
    const canManage = can(session.roles, "service_request.manage", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [a] = await tx
        .select()
        .from(serviceRequestAttachments)
        .where(
          and(
            eq(serviceRequestAttachments.id, attId),
            eq(serviceRequestAttachments.serviceRequestId, id),
            eq(serviceRequestAttachments.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!a) return "not_found" as const;
      if (!canManage && a.uploadedBy !== session.userId) return "forbidden" as const;

      if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
      await tx
        .update(serviceRequestAttachments)
        .set({ deletedAt: new Date() })
        .where(and(eq(serviceRequestAttachments.id, attId), eq(serviceRequestAttachments.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_request.attachment.delete",
        entityType: "service_request",
        entityId: id,
        before: { attachmentId: attId, fileName: a.fileName },
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
