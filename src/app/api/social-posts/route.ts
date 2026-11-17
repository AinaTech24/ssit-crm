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
import { dayRuleError, duplicatePlatformError, parseBatch, sameEntryError } from "@/lib/social/tracker";
import { and, eq } from "drizzle-orm";

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

    // One ENTRY per day: every line shares the date, title and type, and a platform
    // appears once. If the day already has an entry, only more platforms of that same
    // entry may be added to it.
    const bad = sameEntryError(parsed.entries) ?? duplicatePlatformError(parsed.entries);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const date = parsed.entries[0].postDate;

    const refused = await withTenant(session.tenantId, async (tx) => {
      const existing = await tx
        .select({
          contentTitle: socialMediaPosts.contentTitle,
          contentType: socialMediaPosts.contentType,
          platform: socialMediaPosts.platform,
        })
        .from(socialMediaPosts)
        .where(and(eq(socialMediaPosts.tenantId, session.tenantId), eq(socialMediaPosts.postDate, date)));
      return dayRuleError(existing, parsed.entries, { join: true, date });
    });
    if (refused) return NextResponse.json({ error: refused }, { status: 409 });

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
