import { date, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Dhandho — the firm's daily learning session. One row per day: who speaks, and
 * optionally on what. Loaded monthly from an Excel sheet (or added by hand).
 * `remindedAt` is stamped when that day's "today's speaker" reminder went out, so
 * a worker restart or a second server can never send it twice.
 */
export const dhandhoSessions = pgTable(
  "dhandho_sessions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    sessionDate: date("session_date").notNull(),
    /** Set when the speaker is a CRM user — they also get a personal reminder. */
    speakerUserId: uuid("speaker_user_id").references(() => users.id),
    speakerName: text("speaker_name").notNull(),
    topic: text("topic"),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    dateUq: uniqueIndex("dhandho_sessions_date_uq").on(t.tenantId, t.sessionDate),
  })
);

export type DhandhoSession = typeof dhandhoSessions.$inferSelect;
