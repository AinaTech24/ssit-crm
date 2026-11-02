import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { serviceRequests } from "./service_requests";

/**
 * A document attached to a service request — a signed form, a statement, the
 * partner's reply. Mirrors `review_meeting_attachments` / `task_attachments`:
 * bytes live in S3 under `storageKey` (local-disk fallback in lib/storage/s3.ts),
 * the row carries the metadata, and deletes are soft so the audit trail survives.
 */
export const serviceRequestAttachments = pgTable(
  "service_request_attachments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index("service_request_attachments_request_idx").on(t.tenantId, t.serviceRequestId, t.createdAt),
  })
);

export type ServiceRequestAttachment = typeof serviceRequestAttachments.$inferSelect;
