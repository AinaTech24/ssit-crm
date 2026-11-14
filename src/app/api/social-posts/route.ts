import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/social-posts — add one Social Media Tracker entry.
 *
 * Body: the fields in lib/social/tracker.ts (PostFields). Needs social_tracker.manage.
 * Listing is done by the tracker page itself (server-rendered), not through here.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { socialMediaPosts } from "@/db/schema";
import { PostFields } from "@/lib/social/tracker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "social_tracker.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = PostFields.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the fields and try again." }, { status: 400 });
    }
    const b = parsed.data;

    const [row] = await withTenant(session.tenantId, (tx) =>
      tx
        .insert(socialMediaPosts)
        .values({
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
        })
        .returning({ id: socialMediaPosts.id })
    );
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
