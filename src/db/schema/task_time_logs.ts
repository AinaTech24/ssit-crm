import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { tasks } from "./tasks";

/** A single time entry against a task — a manual log or a timer start→stop span. */
export const taskTimeLogs = pgTable(
  "task_time_logs",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index("task_time_logs_task_idx").on(t.tenantId, t.taskId, t.loggedAt),
  })
);

export type TaskTimeLog = typeof taskTimeLogs.$inferSelect;
export type NewTaskTimeLog = typeof taskTimeLogs.$inferInsert;
