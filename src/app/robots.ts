import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.equitywala.com";

/**
 * robots.txt — let crawlers index the public marketing surface, keep the
 * authenticated app + API out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/super-admin/", "/api/", "/r/", "/d/", "/p/", "/lf/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
