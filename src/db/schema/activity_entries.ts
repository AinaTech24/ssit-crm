/**
 * Activity tracker — the work log for roles whose output is not a client record.
 *
 * Marketing logs what was produced (posts, flyers, videos) and who asked for it;
 * RIA/Research logs what was studied and on what topic. One table, one `kind`
 * discriminator, because the shape is the same in both cases (see migration
 * 0208 for why this is not two tables).
 *
 * Distinct from `tasks`: a task is an instruction with a status workflow, this
 * is the record of what was actually produced — which is what these roles are
 * reviewed on, and what a task list alone cannot tell you.
 */

import { bigint, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { tasks } from "./tasks";

export const TRACKER_KINDS = ["marketing", "research"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

/** Item types offered per kind. Free text underneath, so "other" is not a wall. */
export const TRACKER_ITEM_TYPES: Record<TrackerKind, { value: string; label: string }[]> = {
  marketing: [
    { value: "post", label: "Post" },
    { value: "flyer", label: "Flyer" },
    { value: "video", label: "Video" },
    { value: "brochure", label: "Brochure" },
    { value: "other", label: "Other" },
  ],
  research: [
    { value: "note", label: "Research note" },
    { value: "report", label: "Report" },
    { value: "model", label: "Model" },
    { value: "screener", label: "Screener" },
    { value: "other", label: "Other" },
  ],
};

export const TRACKER_STATUSES = ["in_progress", "completed", "cancelled"] as const;

export const TRACKER_ITEM_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(TRACKER_ITEM_TYPES).flat().map((t) => [t.value, t.label])
);

export const activityEntries = pgTable(
  "activity_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    kind: text("kind").notNull().default("marketing"),
    /** Who did the work. */
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    /** The RM who asked. Nullable — self-initiated work is normal. */
    assignedByUserId: uuid("assigned_by_user_id").references(() => users.id),
    /** Free text: a client, a branch, a campaign, or none of those. */
    createdFor: text("created_for"),
    title: text("title").notNull(),
    itemType: text("item_type"),
    eventName: text("event_name"),
    /** Research only — the subject studied. */
    topic: text("topic"),
    notes: text("notes"),
    assignedDate: date("assigned_date"),
    completedDate: date("completed_date"),
    status: text("status").notNull().default("in_progress"),
    /** Optional link back to the task this came from. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    kindIdx: index("activity_entries_kind_idx").on(t.tenantId, t.kind, t.assignedDate),
    ownerIdx: index("activity_entries_owner_idx").on(t.tenantId, t.ownerUserId, t.assignedDate),
    assignerIdx: index("activity_entries_assigner_idx").on(t.tenantId, t.assignedByUserId),
  })
);

/** Files produced. Same shape as task_attachments so EntityAttachments works unchanged. */
export const activityAttachments = pgTable(
  "activity_attachments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activityEntries.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activityIdx: index("activity_attachments_activity_idx").on(t.tenantId, t.activityId, t.createdAt),
  })
);

export type ActivityEntry = typeof activityEntries.$inferSelect;
export type ActivityAttachment = typeof activityAttachments.$inferSelect;
