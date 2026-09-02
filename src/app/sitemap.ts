import type { MetadataRoute } from "next";
import { loadKbSlugs } from "@/lib/kb/articles";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.ssit.com";

/** Sitemap for the public marketing pages + every published KAIZEN article. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const kb = await loadKbSlugs();
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/knowledge-base`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/signup`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/login`, changeFrequency: "monthly", priority: 0.5 },
    ...kb.map((a) => ({
      url: `${SITE_URL}/knowledge-base/${a.slug}`,
      lastModified: a.publishedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
