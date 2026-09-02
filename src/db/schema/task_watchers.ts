import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { tasks } from "./tasks";

/** A follower of a task — gets its notifications without being the assignee. */
export const taskWatchers = pgTable(
  "task_watchers",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("task_watchers_unique").on(t.tenantId, t.taskId, t.userId),
    userIdx: index("task_watchers_user_idx").on(t.tenantId, t.userId),
  })
);

export type TaskWatcher = typeof taskWatchers.$inferSelect;
export type NewTaskWatcher = typeof taskWatchers.$inferInsert;
