import { handleApiError } from "@/lib/api/error-handler";
/**
 * One day's entry of the Social Media Tracker, as a whole.
 *
 * GET /api/social-posts/day?date=YYYY-MM-DD - the platform lines of that day's entry
 *   (needs social_tracker.view or .manage).
 * PUT /api/social-posts/day - replace ONE entry (a content title on a day) in one go: lines
 *   that carry an id are updated, lines without one are added, lines left out are removed.
 *   Other content on the same day is untouched. Date and title may be changed, but not onto a
 *   title the target day already has. Needs social_tracker.manage.
 *
 * Body: { originalDate, originalTitle, entries: [{ id?, postDate, contentTitle, contentType, platform,
 *         status, postLink, views, reach, likes, followersIncrease, leads }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { socialMediaPosts } from "@/db/schema";
import { isIsoDate } from "@/lib/dhandho/schedule";
import { contentRuleError, duplicateLineError, parseBatch, sameEntryError } from "@/lib/social/tracker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (
      !can(session.roles, "social_tracker.manage", session.permissions) &&
      !can(session.roles, "social_tracker.view", session.permissions)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!isIsoDate(date)) return NextResponse.json({ error: "Use a valid date" }, { status: 400 });
    const rows = await withTenant(session.tenantId, (tx) =>
      tx
        .select()
        .from(socialMediaPosts)
        .where(and(eq(socialMediaPosts.tenantId, session.tenantId), eq(socialMediaPosts.postDate, date)))
        .orderBy(socialMediaPosts.createdAt)
    );
    return NextResponse.json({ rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Body = z.object({
  originalDate: z.string().refine(isIsoDate, "Use a valid date"),
  originalTitle: z.string().min(1).max(300),
  entries: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
});

const Uuid = z.string().uuid();

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "social_tracker.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const body = Body.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Check the fields and try again." }, { status: 400 });

    const parsed = parseBatch(body.data.entries);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const ids = body.data.entries.map((e) => (typeof e.id === "string" && Uuid.safeParse(e.id).success ? e.id : null));
    const lines = parsed.entries;

    const bad = sameEntryError(lines) ?? duplicateLineError(lines);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const newDate = lines[0].postDate;

    const result = await withTenant(session.tenantId, async (tx) => {
      const wanted = body.data.originalTitle.trim().toLowerCase();
      const dayRows = await tx
        .select({
          id: socialMediaPosts.id,
          contentTitle: socialMediaPosts.contentTitle,
          contentType: socialMediaPosts.contentType,
          platform: socialMediaPosts.platform,
          postDate: socialMediaPosts.postDate,
        })
        .from(socialMediaPosts)
        .where(and(eq(socialMediaPosts.tenantId, session.tenantId), eq(socialMediaPosts.postDate, body.data.originalDate)));
      // Only the lines of the entry being edited - the day's other content stays as it is.
      const group = dayRows.filter((r) => r.contentTitle.trim().toLowerCase() === wanted);
      const groupIds = new Set(group.map((g) => g.id));
      const keep = ids.filter((i): i is string => !!i);
      if (keep.some((i) => !groupIds.has(i))) return "not_found" as const;

      // Other content already on the day this one is staying on / moving to.
      const onDay = await tx
        .select({
          id: socialMediaPosts.id,
          contentTitle: socialMediaPosts.contentTitle,
          contentType: socialMediaPosts.contentType,
          platform: socialMediaPosts.platform,
        })
        .from(socialMediaPosts)
        .where(and(eq(socialMediaPosts.tenantId, session.tenantId), eq(socialMediaPosts.postDate, newDate)));
      const others = onDay.filter((r) => !groupIds.has(r.id));
      const refused = contentRuleError(others, lines, { join: false, date: newDate });
      if (refused) return { refused } as const;

      // Remove the lines that were taken out.
      const drop = [...groupIds].filter((i) => !keep.includes(i));
      if (drop.length) {
        await tx
          .delete(socialMediaPosts)
          .where(and(eq(socialMediaPosts.tenantId, session.tenantId), inArray(socialMediaPosts.id, drop)));
      }
      for (let n = 0; n < lines.length; n++) {
        const b = lines[n];
        const vals = {
          postDate: b.postDate,
          contentTitle: b.contentTitle,
          contentType: b.contentType,
          platform: b.platform,
          status: b.status,
          postLink: b.postLink,
          driveLink: b.driveLink,
          views: b.views,
          reach: b.reach,
          likes: b.likes,
          followersIncrease: b.followersIncrease,
          leads: b.leads,
          updatedBy: session.userId,
          updatedAt: new Date(),
        };
        const id = ids[n];
        if (id) {
          await tx
            .update(socialMediaPosts)
            .set(vals)
            .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.tenantId, session.tenantId)));
        } else {
          await tx.insert(socialMediaPosts).values({ ...vals, tenantId: session.tenantId, createdBy: session.userId });
        }
      }
      return "ok" as const;
    });

    if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result !== "ok") return NextResponse.json({ error: result.refused }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
