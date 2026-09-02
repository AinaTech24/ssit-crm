/**
 * Knowledge Base loaders for the PUBLIC site.
 *
 * The Knowledge Base is FULLY PUBLIC — scenario, solution and screenshots are
 * all served to anonymous visitors. It was gated behind signup at first; that
 * was reversed deliberately to maximise reach and SEO, with a non-blocking
 * "start free trial" CTA doing the conversion work instead.
 *
 * Screenshots still stream through /api/kb/image/[id] (which redirects to a
 * short-lived presigned URL) so the S3 bucket itself stays private.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { kbArticles, type KbScreenshot } from "@/db/schema";

export type KbCard = {
  slug: string;
  series: string;
  episodeNo: number | null;
  title: string;
  hook: string | null;
  questions: string[];
  modules: string[];
  readMinutes: number | null;
  publishedAt: Date | null;
};

export type PublicArticle = {
  id: string;
  slug: string;
  series: string;
  episodeNo: number | null;
  title: string;
  hook: string | null;
  scenarioMd: string;
  questions: string[];
  modules: string[];
  readMinutes: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: Date | null;
  solutionMd: string;
  screenshots: Array<KbScreenshot & { index: number }>;
  screenshotCount: number;
};

/** Published cards for the hub, newest episode first within each series. */
export async function loadKbCards(series?: string): Promise<KbCard[]> {
  try {
    const rows = await withSystem(async (tx) => {
      const where = series
        ? and(eq(kbArticles.published, true), eq(kbArticles.series, series))
        : eq(kbArticles.published, true);
      return tx
        .select({
          slug: kbArticles.slug,
          series: kbArticles.series,
          episodeNo: kbArticles.episodeNo,
          title: kbArticles.title,
          hook: kbArticles.hook,
          questions: kbArticles.questions,
          modules: kbArticles.modules,
          readMinutes: kbArticles.readMinutes,
          publishedAt: kbArticles.publishedAt,
          sortOrder: kbArticles.sortOrder,
        })
        .from(kbArticles)
        .where(where)
        .orderBy(asc(kbArticles.sortOrder), desc(kbArticles.episodeNo))
        .limit(300);
    });
    return rows.map((r) => ({
      slug: r.slug,
      series: r.series,
      episodeNo: r.episodeNo,
      title: r.title,
      hook: r.hook,
      questions: Array.isArray(r.questions) ? r.questions : [],
      modules: Array.isArray(r.modules) ? r.modules : [],
      readMinutes: r.readMinutes,
      publishedAt: r.publishedAt,
    }));
  } catch {
    return [];
  }
}

/** One published article, in full. No session required — the KB is public. */
export async function loadArticle(slug: string): Promise<PublicArticle | null> {
  try {
    const row = await withSystem(async (tx) => {
      const [r] = await tx
        .select()
        .from(kbArticles)
        .where(and(eq(kbArticles.slug, slug), eq(kbArticles.published, true)))
        .limit(1);
      return r ?? null;
    });
    if (!row) return null;
    const shots: KbScreenshot[] = Array.isArray(row.screenshots) ? row.screenshots : [];
    return {
      id: row.id,
      slug: row.slug,
      series: row.series,
      episodeNo: row.episodeNo,
      title: row.title,
      hook: row.hook,
      scenarioMd: row.scenarioMd,
      questions: Array.isArray(row.questions) ? row.questions : [],
      modules: Array.isArray(row.modules) ? row.modules : [],
      readMinutes: row.readMinutes,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      publishedAt: row.publishedAt,
      solutionMd: row.solutionMd,
      screenshots: shots.map((s, index) => ({ ...s, index })),
      screenshotCount: shots.length,
    };
  } catch {
    return null;
  }
}

/** Slugs for the sitemap. */
export async function loadKbSlugs(): Promise<Array<{ slug: string; publishedAt: Date | null }>> {
  try {
    return await withSystem(async (tx) =>
      tx
        .select({ slug: kbArticles.slug, publishedAt: kbArticles.publishedAt })
        .from(kbArticles)
        .where(eq(kbArticles.published, true))
        .limit(500)
    );
  } catch {
    return [];
  }
}
