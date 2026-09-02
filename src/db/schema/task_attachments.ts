import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { tasks } from "./tasks";

/** A file attached to a task. Stored in S3 (storageKey); soft-deletable. */
export const taskAttachments = pgTable(
  "task_attachments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index("task_attachments_task_idx").on(t.tenantId, t.taskId, t.createdAt),
  })
);

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type NewTaskAttachment = typeof taskAttachments.$inferInsert;
