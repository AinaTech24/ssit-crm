import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/drive/upload-url   { fileName, contentType, size }
 *
 * Step 1 of "upload a video to Google Drive from the CRM": checks Drive is connected and the file is
 * within the limit, then returns a presigned URL so the browser PUTs the file straight into our
 * storage (it never passes through this server). Step 2 is POST /api/drive/uploads.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { presignedPutUrl } from "@/lib/storage/s3";
import { getDriveConfig, MAX_DRIVE_UPLOAD_BYTES } from "@/lib/integrations/google-drive";

export const dynamic = "force-dynamic";

const Body = z.object({
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["social_tracker.manage", "content_library.add", "template.edit"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { fileName, contentType, size } = parsed.data;

    if (!contentType.startsWith("video/")) {
      return NextResponse.json({ error: "Only video files can be sent to Google Drive from here." }, { status: 400 });
    }
    if (size > MAX_DRIVE_UPLOAD_BYTES) {
      const mb = Math.round(MAX_DRIVE_UPLOAD_BYTES / 1024 / 1024);
      return NextResponse.json(
        { error: `This video is larger than ${mb} MB. Upload it to Google Drive yourself and paste the link instead.`, code: "too_large" },
        { status: 413 }
      );
    }
    const cfg = await withTenant(session.tenantId, (tx) => getDriveConfig(tx, session.tenantId));
    if (!cfg?.refreshToken) {
      return NextResponse.json(
        { error: "Google Drive is not connected yet. Ask an owner or admin to connect it in Settings -> Google Drive.", code: "not_connected" },
        { status: 409 }
      );
    }

    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const key = `tenants/${session.tenantId}/drive-staging/${Date.now()}-${safe}`;
    const url = await presignedPutUrl(key, contentType, 3600);
    return NextResponse.json({ url, key });
  } catch (err: any) {
    return handleApiError(err);
  }
}
