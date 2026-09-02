/**
 * Landing-page marketing packages — the public pricing cards, managed by SSIT
 * admins (Super Admin → Landing packages). Purely display/marketing; separate
 * from the billing `packages` master. Platform-scoped (no tenant_id).
 */

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const landingPackages = pgTable(
  "landing_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Card title, e.g. "Growth". */
    name: text("name").notNull(),
    /** Short "who it's for" line under the title. */
    tagline: text("tagline"),

    /** Display strings (marketing copy, not computed). Blank on a custom card. */
    priceLabel: text("price_label"),
    unitLabel: text("unit_label"),
    setupLabel: text("setup_label"),
    /** Pre-discount one-time-setup price, shown struck-through beside setupLabel. */
    setupOriginalLabel: text("setup_original_label"),
    /** Discount banner text, e.g. "20% OFF". Blank = no banner. */
    discountBadge: text("discount_badge"),
    seatsLabel: text("seats_label"),
    /** e.g. "Everything in Growth, plus:" shown above the feature list. */
    inheritsLabel: text("inherits_label"),

    /** Bullet feature list. */
    features: jsonb("features").$type<string[]>().notNull().default([]),

    /** Highlighted card → "Most Popular" aurora treatment. */
    featured: boolean("featured").notNull().default(false),
    /** Badge text (defaults to "Most Popular"/"Enterprise" when unset). */
    badgeLabel: text("badge_label"),
    /** No-pricing enterprise card → shows a "Call now"/CTA button instead of price. */
    isCustom: boolean("is_custom").notNull().default(false),

    ctaLabel: text("cta_label").notNull().default("Start Free Trial"),
    /** "/signup" for normal cards, "tel:+91…" for a call-now card. */
    ctaHref: text("cta_href").notNull().default("/signup"),

    sortOrder: integer("sort_order").notNull().default(0),
    published: boolean("published").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("landing_packages_order_idx").on(t.published, t.sortOrder),
  })
);

export type LandingPackage = typeof landingPackages.$inferSelect;
export type NewLandingPackage = typeof landingPackages.$inferInsert;
