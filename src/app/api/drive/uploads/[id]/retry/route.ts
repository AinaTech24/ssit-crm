import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/drive/uploads/:id/retry - run a failed copy again (the staged file is still there).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { driveUploads } from "@/db/schema";
import { effectiveStatus, startDriveTransfer } from "@/lib/integrations/drive-transfer";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["social_tracker.manage", "content_library.add", "template.edit"], session.permissions);
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(driveUploads)
        .where(and(eq(driveUploads.id, id), eq(driveUploads.tenantId, session.tenantId)))
        .limit(1);
      return r ?? null;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (effectiveStatus(row) !== "failed") return NextResponse.json({ error: "this upload is not in a failed state" }, { status: 409 });
    if (!row.storageKey) return NextResponse.json({ error: "The staged file is gone - upload the video again." }, { status: 410 });
    await withTenant(session.tenantId, (tx) =>
      tx.update(driveUploads).set({ status: "pending", error: null, updatedAt: new Date() }).where(eq(driveUploads.id, id))
    );
    startDriveTransfer(session.tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
