import { bigint, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * One file on its way from the CRM to the firm's Google Drive. The upload goes to our
 * storage first; a background copy then moves it into a month folder in Drive and, once Drive
 * has confirmed the file is whole, deletes the staging copy. `status` is what the screens poll.
 */
export const DRIVE_UPLOAD_STATUSES = ["pending", "uploading", "done", "failed"] as const;
export type DriveUploadStatus = (typeof DRIVE_UPLOAD_STATUSES)[number];

export const driveUploads = pgTable(
  "drive_uploads",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    createdBy: uuid("created_by").references(() => users.id),
    source: text("source").notNull().default("social_tracker"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    storageKey: text("storage_key"),
    folderDate: date("folder_date").notNull(),
    status: text("status", { enum: DRIVE_UPLOAD_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    driveFileId: text("drive_file_id"),
    driveUrl: text("drive_url"),
    driveFolder: text("drive_folder"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index("drive_uploads_tenant_idx").on(t.tenantId, t.createdAt),
  })
);

export type DriveUpload = typeof driveUploads.$inferSelect;
