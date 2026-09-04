import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/super-admin/kb-articles — list every KB article (published or not)
 * POST /api/super-admin/kb-articles — create one
 * Gated by platform.package.manage (Equitywala Super Admin / Admin).
 */

import { NextRequest, NextResponse } from "next/server";
import { asc, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { kbArticles } from "@/db/schema";
import { KbBody } from "@/lib/kb/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const rows = await withPlatformAdmin(session.userId, async (tx) =>
      tx
        .select({
          id: kbArticles.id,
          series: kbArticles.series,
          episodeNo: kbArticles.episodeNo,
          slug: kbArticles.slug,
          title: kbArticles.title,
          hook: kbArticles.hook,
          published: kbArticles.published,
          publishedAt: kbArticles.publishedAt,
          sortOrder: kbArticles.sortOrder,
          modules: kbArticles.modules,
          questions: kbArticles.questions,
          screenshots: kbArticles.screenshots,
          updatedAt: kbArticles.updatedAt,
        })
        .from(kbArticles)
        .orderBy(asc(kbArticles.sortOrder), desc(kbArticles.episodeNo))
        .limit(500)
    );
    return NextResponse.json({ articles: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const parse = KbBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const d = parse.data;
    const row = await withPlatformAdmin(session.userId, async (tx) => {
      const [r] = await tx
        .insert(kbArticles)
        .values({
          series: d.series ?? "KAIZEN",
          episodeNo: d.episodeNo ?? null,
          slug: d.slug,
          title: d.title,
          hook: d.hook ?? null,
          scenarioMd: d.scenarioMd ?? "",
          questions: d.questions ?? [],
          solutionMd: d.solutionMd ?? "",
          screenshots: (d.screenshots ?? []) as any,
          modules: d.modules ?? [],
          readMinutes: d.readMinutes ?? null,
          coverKey: d.coverKey ?? null,
          seoTitle: d.seoTitle ?? null,
          seoDescription: d.seoDescription ?? null,
          published: d.published ?? false,
          publishedAt: d.published ? new Date() : null,
          sortOrder: d.sortOrder ?? 0,
        } as any)
        .returning({ id: kbArticles.id, slug: kbArticles.slug });
      return r;
    });
    revalidatePath("/knowledge-base");
    revalidatePath(`/knowledge-base/${row.slug}`);
    return NextResponse.json({ id: row.id, slug: row.slug }, { status: 201 });
  } catch (err: any) {
    // Unique slug collision surfaces as a 23505 from Postgres.
    if (String(err?.code) === "23505") {
      return NextResponse.json({ error: "That slug is already used by another article." }, { status: 409 });
    }
    return handleApiError(err);
  }
}
