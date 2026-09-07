import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/[id]/attachments/[attId]/download — stream a meeting
 * attachment back to the browser.
 *
 * The bytes are proxied rather than handed out as a presigned S3 URL so the
 * tenant + meeting access check runs on every download and the bucket stays
 * private. Fetched as a blob by DownloadButton, so the route never shows up in
 * the browser's address bar.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { reviewMeetings, reviewMeetingAttachments } from "@/db/schema";
import { getObjectBytes } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> }
) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);

    const att = await withTenant(session.tenantId, async (tx) => {
      const [m] = await tx
        .select({ createdById: reviewMeetings.createdById, collaboratorIds: reviewMeetings.collaboratorIds, rmId: reviewMeetings.rmId })
        .from(reviewMeetings)
        .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)))
        .limit(1);
      if (!m) return null;
      if (!canAll && !(m.createdById === session.userId || (Array.isArray(m.collaboratorIds) && m.collaboratorIds.includes(session.userId)) || (!m.createdById && m.rmId === session.userId))) return null;
      const [a] = await tx
        .select()
        .from(reviewMeetingAttachments)
        .where(
          and(
            eq(reviewMeetingAttachments.id, attId),
            eq(reviewMeetingAttachments.meetingId, id),
            eq(reviewMeetingAttachments.tenantId, session.tenantId),
            isNull(reviewMeetingAttachments.deletedAt)
          )
        )
        .limit(1);
      return a ?? null;
    });
    if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

    const bytes = await getObjectBytes(att.storageKey);
    return new NextResponse(bytes as any, {
      status: 200,
      headers: {
        "Content-Type": att.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(att.fileName)}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
