import { date, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Daily Job Tracker (DJT) — a per-user, per-day reflection + planning ritual,
 * adopted from the MFD's Excel "Daily Job Tracker".
 *
 * The "productive & completed" and "non-productive & incomplete" sections are
 * auto-derived from the user's tasks (completed yesterday vs carried-over), so
 * only the reflective + planning fields are stored here. One row per user/day.
 */
export const dailyTrackers = pgTable(
  "daily_trackers",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    trackerDate: date("tracker_date").notNull(),

    /** 3. One key learning from the previous day. */
    keyLearning: text("key_learning"),
    /** 5. Breakdown — what went wrong / got stuck. */
    breakdown: text("breakdown"),
    /** 6. Breakthrough — the win. */
    breakthrough: text("breakthrough"),

    /** 4. Today's important & productive work — the chosen focus list. Each item
     *  can stand alone or point at a task; `forType` mirrors the DJT's
     *  Client / Lead / Other tag. */
    todayFocus: jsonb("today_focus")
      .$type<Array<{ text: string; taskId?: string; done?: boolean; forType?: "client" | "lead" | "other" }>>()
      .default([]),

    ...timestamps,
  },
  (t) => ({
    userDateUnique: uniqueIndex("daily_trackers_user_date_unique").on(t.tenantId, t.userId, t.trackerDate),
    dateIdx: index("daily_trackers_date_idx").on(t.tenantId, t.trackerDate),
  })
);

export type DailyTracker = typeof dailyTrackers.$inferSelect;
export type NewDailyTracker = typeof dailyTrackers.$inferInsert;
