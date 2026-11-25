import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/drive/uploads/:id - where is this file on its way to Google Drive?
 * -> { status: pending | uploading | done | failed, driveUrl?, driveFolder?, error? }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { driveUploads } from "@/db/schema";
import { effectiveStatus } from "@/lib/integrations/drive-transfer";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["social_tracker.manage", "social_tracker.view", "content_library.add", "template.edit"], session.permissions);
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(driveUploads)
        .where(and(eq(driveUploads.id, id), eq(driveUploads.tenantId, session.tenantId)))
        .limit(1);
      return r ?? null;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const status = effectiveStatus(row);
    return NextResponse.json({
      id: row.id,
      status,
      fileName: row.fileName,
      driveUrl: row.driveUrl,
      driveFolder: row.driveFolder,
      error: status === "failed" ? row.error ?? "The copy to Google Drive did not finish - try again." : null,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
