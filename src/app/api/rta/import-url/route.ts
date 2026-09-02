import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/rta/import-url
 *
 * Presigned S3 PUT URL for the RICH master/holdings importer so the browser
 * uploads large files (CAMS R9 .xls, KFintech masters) DIRECTLY to S3 —
 * bypassing the app body limit. The client then calls /api/rta/import-async
 * with the returned key. Body: { filename, contentType? } → { url, key }.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { presignedPutUrl } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().max(150).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const allowed =
      can(session.roles, "investor.edit.all", session.permissions) ||
      can(session.roles, "dashboard.view.owner", session.permissions);
    if (!allowed) {
      return NextResponse.json({ error: "You don't have permission to import the client master." }, { status: 403 });
    }
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const safe = parse.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const key = `tenants/${session.tenantId}/rta/${Date.now()}-${safe}`;
    const contentType = parse.data.contentType || "application/octet-stream";
    const url = await presignedPutUrl(key, contentType, 900);
    return NextResponse.json({ url, key });
  } catch (err: any) {
    return handleApiError(err);
  }
}
