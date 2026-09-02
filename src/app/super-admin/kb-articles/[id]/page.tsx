import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { kbArticles } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { KbArticleForm, type KbShot } from "@/components/super-admin/KbArticleForm";

export const dynamic = "force-dynamic";

export default async function EditKbArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  const row = await withPlatformAdmin(session.userId, async (tx) => {
    const [r] = await tx.select().from(kbArticles).where(eq(kbArticles.id, id)).limit(1);
    return r ?? null;
  });
  if (!row) notFound();

  return (
    <KbArticleForm
      initial={{
        id: row.id,
        series: row.series,
        episodeNo: row.episodeNo,
        slug: row.slug,
        title: row.title,
        hook: row.hook,
        scenarioMd: row.scenarioMd,
        questions: Array.isArray(row.questions) ? (row.questions as string[]) : [],
        solutionMd: row.solutionMd,
        screenshots: Array.isArray(row.screenshots) ? (row.screenshots as KbShot[]) : [],
        modules: Array.isArray(row.modules) ? (row.modules as string[]) : [],
        readMinutes: row.readMinutes,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        published: row.published,
        sortOrder: row.sortOrder,
      }}
    />
  );
}
