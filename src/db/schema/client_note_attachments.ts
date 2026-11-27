import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { activities } from "./activities";

/** An image or PDF attached to a note on a client (the Engagement tab). Bytes live in storage. */
export const clientNoteAttachments = pgTable(
  "client_note_attachments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    storageKey: text("storage_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    noteIdx: index("client_note_attachments_note_idx").on(t.tenantId, t.activityId, t.createdAt),
  })
);

export type ClientNoteAttachment = typeof clientNoteAttachments.$inferSelect;
