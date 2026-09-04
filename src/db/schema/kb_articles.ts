/**
 * Public Knowledge Base articles — the "KAIZEN" series and any future series.
 * Platform-level (no tenant_id → no RLS), authored by Equitywala admins.
 *
 * Gating: `scenarioMd` + `questions` are PUBLIC; `solutionMd` + `screenshots`
 * require a logged-in session. See migration 0185.
 */

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export type KbScreenshot = { storageKey: string; caption?: string | null; alt?: string | null };

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    series: text("series").notNull().default("KAIZEN"),
    episodeNo: integer("episode_no"),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    hook: text("hook"),

    /** PUBLIC — the scenario, shown to everyone (and crawlable). */
    scenarioMd: text("scenario_md").notNull().default(""),
    /** PUBLIC — the questions the scenario raises. */
    questions: jsonb("questions").$type<string[]>().notNull().default([]),

    /** GATED — how the CRM solves it. Requires a session. */
    solutionMd: text("solution_md").notNull().default(""),
    /** GATED — screenshots, streamed via /api/kb/image/[id]. */
    screenshots: jsonb("screenshots").$type<KbScreenshot[]>().notNull().default([]),

    /** CRM modules this scenario touches — rendered as tags. */
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    readMinutes: integer("read_minutes"),
    /** Optional PUBLIC cover image storage key. */
    coverKey: text("cover_key"),

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    published: boolean("published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("kb_articles_slug_unique").on(t.slug),
    pubIdx: index("kb_articles_pub_idx").on(t.published, t.series, t.episodeNo),
  })
);

export type KbArticle = typeof kbArticles.$inferSelect;
export type NewKbArticle = typeof kbArticles.$inferInsert;
