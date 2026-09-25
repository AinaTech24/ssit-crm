import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { announcements } from "./announcements";

/**
 * A file attached to an announcement — the document, image or video that the
 * notice is actually about ("the new SIP process", "the office move map").
 *
 * Bytes live in S3 (storageKey), never in the row; deletes are soft so the
 * audit trail survives. Mirrors task_attachments / review_meeting_attachments
 * exactly, including ON DELETE CASCADE, so all three share one client
 * component and one route contract.
 */
export const announcementAttachments = pgTable(
  "announcement_attachments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    announcementIdx: index("announcement_attachments_announcement_idx").on(
      t.tenantId,
      t.announcementId,
      t.createdAt
    ),
  })
);

export type AnnouncementAttachment = typeof announcementAttachments.$inferSelect;
export type NewAnnouncementAttachment = typeof announcementAttachments.$inferInsert;
