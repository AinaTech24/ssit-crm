/**
 * In-app notifications.
 *
 * Each row is one notification delivered to one user (fan-out, not broadcast).
 * Triggers across the app create rows here; the bell-icon poll in the topbar
 * reads them. Workflow actions (`raise_alert`) also write here.
 */

import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const notifications = pgTable(
  "notifications",
  {
    id,
    tenantId,
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(), // 'task.assigned' | 'sip.rejected' | 'review.due' | 'compliance.alert' | ...
    title: text("title").notNull(),
    body: text("body"),
    /** Optional deep link, e.g. '/dashboard/investors/<id>' */
    linkUrl: text("link_url"),
    severity: text("severity", { enum: ["info", "success", "warning", "critical"] })
      .notNull()
      .default("info"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Free-form context — what triggered this. */
    meta: jsonb("meta"),
    ...timestamps,
  },
  (t) => ({
    userUnreadIdx: index("notifications_user_unread_idx").on(t.userId, t.readAt),
    kindIdx: index("notifications_kind_idx").on(t.tenantId, t.kind, t.createdAt),
  })
);

export type Notification = typeof notifications.$inferSelect;
