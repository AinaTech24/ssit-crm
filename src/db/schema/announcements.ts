/**
 * Announcements — internal team notice board (Sanchay "Announcements" parity).
 *
 * Owners / branch heads post firm-wide (or branch- / role-scoped) notices that
 * staff see on login (a strip on the dashboard) and on the Announcements page.
 * Distinct from `tenant_circulars` (the AMFI regulatory circular digest) — this
 * is internal operational comms ("Office closed Fri", "New SIP process live").
 */

import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const ANNOUNCEMENT_CATEGORIES = [
  "general",
  "policy",
  "event",
  "system",
  "urgent",
  // Added for the kinds of notice firms actually post: a visit or review with
  // an AMC, a joiner/leaver or other staff notice, and a win worth telling the
  // firm about.
  "amc_meeting",
  "staff",
  "achievement",
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const announcements = pgTable(
  "announcements",
  {
    id,
    tenantId,
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category", { enum: ANNOUNCEMENT_CATEGORIES }).notNull().default("general"),

    /**
     * Target audience by role. Empty / null array = everyone in the tenant.
     * Otherwise the viewer must hold at least one of these roles.
     */
    audienceRoles: jsonb("audience_roles").$type<string[]>().default([]),
    /** Optional branch scope — null = all branches. */
    branchId: uuid("branch_id"),
    /**
     * Optional SUB-BRANCH scope (migration 0233). Most firms run one branch, so
     * the desk is the unit a notice is usually aimed at. NULL = not desk-scoped.
     */
    deskId: uuid("desk_id"),

    isPinned: boolean("is_pinned").notNull().default(false),
    /** When true, staff must explicitly click "I acknowledge" (policy/urgent
     *  notices). Managers see who's outstanding. */
    requiresAck: boolean("requires_ack").notNull().default(false),
    /** Null until published (draft). Active = published & now < expiresAt. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdByUserId: uuid("created_by_user_id"),

    ...timestamps,
  },
  (t) => ({
    activeIdx: index("announcements_active_idx").on(t.tenantId, t.publishedAt, t.expiresAt),
    pinnedIdx: index("announcements_pinned_idx").on(t.tenantId, t.isPinned),
  })
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

/**
 * Per-user read / acknowledgement of an announcement. `readAt` = saw it;
 * `acknowledgedAt` = clicked "I acknowledge" (for requiresAck notices). Powers
 * the dashboard strip's unread filter + the manager "X of Y acknowledged" view.
 */
export const announcementReads = pgTable(
  "announcement_reads",
  {
    id,
    tenantId,
    announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("announcement_reads_unique").on(t.announcementId, t.userId),
    userIdx: index("announcement_reads_user_idx").on(t.tenantId, t.userId),
  })
);

export type AnnouncementRead = typeof announcementReads.$inferSelect;
