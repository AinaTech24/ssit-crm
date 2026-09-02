import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { tasks } from "./tasks";

/**
 * Threaded comments on a task — the real, structured replacement for the old
 * single prepend-only `tasks.remarks` blob. Each comment has an author, a
 * timestamp, and an optional list of @mentioned user ids (each mentioned user
 * gets a `task.mention` notification). Soft-deletable by the author / an owner.
 */
export const taskComments = pgTable(
  "task_comments",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id),
    body: text("body").notNull(),
    /** Mentioned user ids — drives the @mention notifications. */
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    taskIdx: index("task_comments_task_idx").on(t.tenantId, t.taskId, t.createdAt),
  })
);

export type TaskComment = typeof taskComments.$inferSelect;
export type NewTaskComment = typeof taskComments.$inferInsert;
