import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/drive/uploads   { key, fileName, contentType, source, folderDate? }
 *
 * Step 2: the file is in our storage; queue the copy to Google Drive and return the upload's id.
 * The copy runs in the background (see lib/integrations/drive-transfer.ts); poll
 * GET /api/drive/uploads/:id for its status and, when done, the Drive link.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { driveUploads } from "@/db/schema";
import { objectSize } from "@/lib/storage/s3";
import { MAX_DRIVE_UPLOAD_BYTES } from "@/lib/integrations/google-drive";
import { startDriveTransfer } from "@/lib/integrations/drive-transfer";
import { isIsoDate } from "@/lib/dhandho/schedule";

export const dynamic = "force-dynamic";

const Body = z.object({
  key: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
  source: z.enum(["social_tracker", "content_library"]).default("social_tracker"),
  /** The day the month folder is chosen from (a post's date); defaults to today. */
  folderDate: z.string().refine(isIsoDate, "Use a valid date").optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["social_tracker.manage", "content_library.add", "template.edit"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const b = parsed.data;

    // Only files this firm staged through /api/drive/upload-url.
    if (!b.key.startsWith(`tenants/${session.tenantId}/drive-staging/`)) {
      return NextResponse.json({ error: "invalid file" }, { status: 400 });
    }
    const size = await objectSize(b.key);
    if (size == null) return NextResponse.json({ error: "The upload did not reach storage - please upload the video again." }, { status: 400 });
    if (size > MAX_DRIVE_UPLOAD_BYTES) return NextResponse.json({ error: "This video is larger than the limit." }, { status: 413 });

    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .insert(driveUploads)
        .values({
          tenantId: session.tenantId,
          createdBy: session.userId,
          source: b.source,
          fileName: b.fileName,
          contentType: b.contentType,
          sizeBytes: size,
          storageKey: b.key,
          folderDate: b.folderDate ?? today,
          status: "pending",
        })
        .returning({ id: driveUploads.id });
      return r;
    });
    startDriveTransfer(session.tenantId, row.id);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
