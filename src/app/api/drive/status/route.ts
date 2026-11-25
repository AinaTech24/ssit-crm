import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/drive/status - is Google Drive connected, and how big a video may be?
 * Read by the video uploaders so they can say "Connect Google Drive first" instead of failing late.
 * (The connection itself is managed by owners/admins under Settings -> Google Drive.)
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { getDriveConfig, MAX_DRIVE_UPLOAD_BYTES } from "@/lib/integrations/google-drive";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["social_tracker.manage", "social_tracker.view", "content_library.add", "template.edit", "settings.users"], session.permissions);
    const cfg = await withTenant(session.tenantId, (tx) => getDriveConfig(tx, session.tenantId));
    return NextResponse.json({ connected: !!cfg?.refreshToken, email: cfg?.email ?? null, maxBytes: MAX_DRIVE_UPLOAD_BYTES });
  } catch (err: any) {
    return handleApiError(err);
  }
}
