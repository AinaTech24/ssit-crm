import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { reviewMeetings } from "./review_meetings";

/**
 * A document attached to a review meeting — agenda packs, the client's existing
 * statements, a signed mandate, notes scanned after the meeting.
 *
 * Mirrors `task_attachments`: bytes live in S3 under `storageKey` (with the
 * local-disk fallback in lib/storage/s3.ts when no S3 keys are configured), the
 * row carries the metadata, and deletes are soft so the audit trail survives.
 *
 * This supersedes the legacy `review_meetings.attachments` jsonb column, which
 * only held pasted URLs and is kept read-only for rows written before this.
 */
export const reviewMeetingAttachments = pgTable(
  "review_meeting_attachments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => reviewMeetings.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    meetingIdx: index("review_meeting_attachments_meeting_idx").on(
      t.tenantId,
      t.meetingId,
      t.createdAt
    ),
  })
);

export type ReviewMeetingAttachment = typeof reviewMeetingAttachments.$inferSelect;
export type NewReviewMeetingAttachment = typeof reviewMeetingAttachments.$inferInsert;
