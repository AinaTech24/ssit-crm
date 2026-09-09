import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/activity-entries/[id]/attachments/[attId]/download — stream a task attachment.
 * Accessed via the secure DownloadButton (blob fetch), so the route never
 * appears in the browser chrome.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { activityEntries, activityAttachments } from "@/db/schema";
import { getObjectBytes } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const att = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ ownerUserId: activityEntries.ownerUserId, assignedByUserId: activityEntries.assignedByUserId })
        .from(activityEntries)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return null;
      if (!canViewAll && t.ownerUserId !== session.userId && t.assignedByUserId !== session.userId) return null;
      const [a] = await tx
        .select()
        .from(activityAttachments)
        .where(and(eq(activityAttachments.id, attId), eq(activityAttachments.activityId, id), eq(activityAttachments.tenantId, session.tenantId), isNull(activityAttachments.deletedAt)))
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
