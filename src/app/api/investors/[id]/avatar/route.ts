/**
 * GET /api/investors/[id]/avatar
 *
 * Serves the client's photo by redirecting to a short-lived presigned URL
 * (or the local-disk path in dev). Tenant-scoped. 404 when the client has no
 * avatar, so an <img onError> can fall back to initials.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investors } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const avatar = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select({ avatarUrl: investors.avatarUrl })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      return r?.avatarUrl ?? null;
    });
    if (!avatar) return new NextResponse(null, { status: 404 });

    const url = /^https?:\/\//i.test(avatar) ? avatar : await presignedGetUrl(avatar, 600, undefined, true);
    const target = url.startsWith("/") ? new URL(url, req.url).toString() : url;
    return NextResponse.redirect(target);
  } catch (err) {
    return handleApiError(err);
  }
}
