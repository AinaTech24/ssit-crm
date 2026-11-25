import { date, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Social Media Tracker — one row per piece of content the marketing team posts and
 * how it performed. Type / platform / status are plain text (the allowed values live
 * in lib/social/tracker.ts) so the lists can grow without a migration.
 */
export const socialMediaPosts = pgTable(
  "social_media_posts",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    postDate: date("post_date").notNull(),
    contentTitle: text("content_title").notNull(),
    contentType: text("content_type").notNull().default("post"),
    platform: text("platform").notNull(),
    status: text("status").notNull().default("planned"),
    postLink: text("post_link"),
    /** Where the entry's video lives in Google Drive (same value on each of the entry's lines). */
    driveLink: text("drive_link"),
    views: integer("views").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    followersIncrease: integer("followers_increase").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    dateIdx: index("social_media_posts_date_idx").on(t.tenantId, t.postDate),
  })
);

export type SocialMediaPost = typeof socialMediaPosts.$inferSelect;
