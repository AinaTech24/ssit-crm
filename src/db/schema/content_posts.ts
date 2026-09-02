import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { users } from "./users";
import { campaigns } from "./campaigns";

/**
 * Social Media Calendar — spec § Module 17.
 *
 * One row per scheduled social-media post. Each post must pass two gates
 * before it can be marked as posted:
 *   1. complianceChecked = true   (SEBI tagline + ARN + no return-promise etc.)
 *   2. approvalStatus = 'approved'
 * The API enforces this on PATCH — any attempt to set postedStatus='posted'
 * while either gate is open returns 409.
 */

export const POST_PLATFORMS = [
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "x_twitter",
  "whatsapp_status",
  "telegram",
  "blog",
  "other",
] as const;

export const POST_CONTENT_TYPES = [
  "image_post",
  "carousel",
  "video_reel",
  "story",
  "live",
  "article",
  "infographic",
  "text",
  "other",
] as const;

export const POST_APPROVAL_STATUSES = [
  "pending",
  "in_review",
  "approved",
  "rejected",
  "not_required",
] as const;

export const POST_POSTING_STATUSES = [
  "not_posted",
  "scheduled",
  "posted",
  "failed",
  "cancelled",
] as const;

export const contentPosts = pgTable(
  "content_posts",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    /** When the content is scheduled / actually posted. */
    contentDate: date("content_date").notNull(),
    platform: text("platform", { enum: POST_PLATFORMS }).notNull(),
    contentType: text("content_type", { enum: POST_CONTENT_TYPES }).notNull().default("image_post"),

    /** Topic / theme — short label like "Diwali Tax Saving" */
    topic: text("topic").notNull(),
    /** Full caption text (with hashtags). */
    caption: text("caption"),

    /** Creative file(s) — URL list. The first entry is the primary preview. */
    creativeFiles: jsonb("creative_files")
      .$type<Array<{ name: string; url: string; kind?: "image" | "video" | "doc" }>>()
      .default([]),

    /** Compliance gate (human sign-off). */
    complianceChecked: boolean("compliance_checked").notNull().default(false),
    complianceCheckedAt: timestamp("compliance_checked_at", { withTimezone: true }),
    complianceCheckedByUserId: uuid("compliance_checked_by_user_id").references(() => users.id),
    complianceNotes: text("compliance_notes"),
    /** Automated deterministic scan of the caption (advisory) — surfaces SEBI
     *  red flags (guaranteed-returns language, missing disclaimer, etc.) to the
     *  human reviewer. Shape: { findings, blocked, score } from runComplianceChecks. */
    complianceScan: jsonb("compliance_scan"),

    /** Approval gate. */
    approvalStatus: text("approval_status", { enum: POST_APPROVAL_STATUSES })
      .notNull()
      .default("pending"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    /** Posting lifecycle. */
    postedStatus: text("posted_status", { enum: POST_POSTING_STATUSES })
      .notNull()
      .default("not_posted"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** URL of the actual posted content (Instagram permalink, LinkedIn share URL, etc.) */
    postLink: text("post_link"),

    /** Optional link to a Marketing Campaign — for ROI rollup. */
    campaignId: uuid("campaign_id").references(() => campaigns.id),

    remarks: text("remarks"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),

    ...timestamps,
  },
  (t) => ({
    dateIdx: index("cp_date_idx").on(t.tenantId, t.contentDate),
    platformIdx: index("cp_platform_idx").on(t.tenantId, t.platform, t.contentDate),
    postingIdx: index("cp_posting_idx").on(t.tenantId, t.postedStatus, t.contentDate),
    approvalIdx: index("cp_approval_idx").on(t.tenantId, t.approvalStatus),
  })
);

export type ContentPost = typeof contentPosts.$inferSelect;
export type NewContentPost = typeof contentPosts.$inferInsert;
