import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/announcements/[id]/attachments/[attId]/download — stream an
 * announcement attachment. Accessed via the secure DownloadButton (blob
 * fetch), so the route never appears in the browser chrome.
 *
 * Gated by the same visibility test as the notice itself, so scoping a notice
 * to one branch or role cannot be walked around by guessing a file URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { announcementAttachments } from "@/db/schema";
import { getObjectBytes } from "@/lib/storage/s3";
import { canViewAnnouncement } from "@/lib/announcements/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();

    const att = await withTenant(session.tenantId, async (tx) => {
      if (!(await canViewAnnouncement(tx, session, id))) return null;
      const [a] = await tx
        .select()
        .from(announcementAttachments)
        .where(
          and(
            eq(announcementAttachments.id, attId),
            eq(announcementAttachments.announcementId, id),
            eq(announcementAttachments.tenantId, session.tenantId),
            isNull(announcementAttachments.deletedAt)
          )
        )
        .limit(1);
      return a ?? null;
    });
    if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

    const bytes = await getObjectBytes(att.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
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
