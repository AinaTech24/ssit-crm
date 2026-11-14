import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/social-posts/[id] — change an entry (any subset of the fields).
 * DELETE /api/social-posts/[id] — remove an entry.
 *
 * Both need social_tracker.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { socialMediaPosts } from "@/db/schema";
import { PostFields } from "@/lib/social/tracker";

export const dynamic = "force-dynamic";

const Patch = PostFields.partial();
const Id = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "social_tracker.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    if (!Id.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parsed = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the fields and try again." }, { status: 400 });
    }
    // A field the caller left out is undefined (an optional field is not defaulted),
    // so a partial edit only touches what was sent — the other numbers stay as they were.
    const set: Record<string, unknown> = { updatedBy: session.userId, updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) set[k] = v;

    const updated = await withTenant(session.tenantId, (tx) =>
      tx
        .update(socialMediaPosts)
        .set(set)
        .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.tenantId, session.tenantId)))
        .returning({ id: socialMediaPosts.id })
    );
    if (updated.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "social_tracker.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    if (!Id.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const gone = await withTenant(session.tenantId, (tx) =>
      tx
        .delete(socialMediaPosts)
        .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.tenantId, session.tenantId)))
        .returning({ id: socialMediaPosts.id })
    );
    if (gone.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
