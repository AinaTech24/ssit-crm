import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/super-admin/kb-articles/[id] — full article for the editor
 * PATCH  /api/super-admin/kb-articles/[id] — update
 * DELETE /api/super-admin/kb-articles/[id] — remove
 * Gated by platform.package.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { kbArticles } from "@/db/schema";
import { KbPatchBody as Patch } from "@/lib/kb/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const row = await withPlatformAdmin(session.userId, async (tx) => {
      const [r] = await tx.select().from(kbArticles).where(eq(kbArticles.id, id)).limit(1);
      return r ?? null;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ article: row });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const patch: any = { updatedAt: new Date() };
    for (const k of [
      "series", "episodeNo", "slug", "title", "hook", "scenarioMd", "questions", "solutionMd",
      "screenshots", "modules", "readMinutes", "coverKey", "seoTitle", "seoDescription",
      "published", "sortOrder",
    ] as const) {
      if (parse.data[k] !== undefined) patch[k] = parse.data[k];
    }

    const out = await withPlatformAdmin(session.userId, async (tx) => {
      const [before] = await tx
        .select({ slug: kbArticles.slug, published: kbArticles.published, publishedAt: kbArticles.publishedAt })
        .from(kbArticles)
        .where(eq(kbArticles.id, id))
        .limit(1);
      if (!before) return null;
      // Stamp publishedAt the first time it goes live; keep the original date on
      // later edits so the article doesn't appear "new" every time we fix a typo.
      if (patch.published === true && !before.publishedAt) patch.publishedAt = new Date();
      await tx.update(kbArticles).set(patch).where(eq(kbArticles.id, id));
      return { oldSlug: before.slug, newSlug: patch.slug ?? before.slug };
    });
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });

    revalidatePath("/knowledge-base");
    revalidatePath(`/knowledge-base/${out.oldSlug}`);
    if (out.newSlug !== out.oldSlug) revalidatePath(`/knowledge-base/${out.newSlug}`);
    return NextResponse.json({ ok: true, slug: out.newSlug });
  } catch (err: any) {
    if (String(err?.code) === "23505") {
      return NextResponse.json({ error: "That slug is already used by another article." }, { status: 409 });
    }
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const slug = await withPlatformAdmin(session.userId, async (tx) => {
      const [r] = await tx.select({ slug: kbArticles.slug }).from(kbArticles).where(eq(kbArticles.id, id)).limit(1);
      await tx.delete(kbArticles).where(eq(kbArticles.id, id));
      return r?.slug ?? null;
    });
    revalidatePath("/knowledge-base");
    if (slug) revalidatePath(`/knowledge-base/${slug}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
