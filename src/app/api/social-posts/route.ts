import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/social-posts — add Social Media Tracker entries.
 *
 * Body: { entries: PostFields[] } (the entry sheet adds several rows at once), or a
 * single PostFields object. All rows are validated first and saved together — one bad
 * row adds none. Needs social_tracker.manage.
 * Listing is done by the tracker page itself (server-rendered), not through here.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { socialMediaPosts } from "@/db/schema";
import { parseBatch } from "@/lib/social/tracker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "social_tracker.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const body = await req.json().catch(() => ({}));
    const parsed = parseBatch(Array.isArray(body?.entries) ? body.entries : [body]);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const rows = await withTenant(session.tenantId, (tx) =>
      tx
        .insert(socialMediaPosts)
        .values(
          parsed.entries.map((b) => ({
            tenantId: session.tenantId,
            postDate: b.postDate,
            contentTitle: b.contentTitle,
            contentType: b.contentType,
            platform: b.platform,
            status: b.status,
            postLink: b.postLink,
            views: b.views,
            reach: b.reach,
            likes: b.likes,
            followersIncrease: b.followersIncrease,
            leads: b.leads,
            createdBy: session.userId,
            updatedBy: session.userId,
          }))
        )
        .returning({ id: socialMediaPosts.id })
    );
    return NextResponse.json({ ok: true, id: rows[0]?.id, ids: rows.map((r) => r.id), count: rows.length }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
