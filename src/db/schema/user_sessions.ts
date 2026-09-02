/**
 * Per-device login sessions. One row per login, keyed by the session id (sid)
 * embedded in the JWT. Powers the "your devices" list, per-device logout, and
 * last-seen presence (active/inactive). revoked_at set on logout / sign-out-all
 * / account deactivation.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const userSessions = pgTable(
  "user_sessions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    /** The `sid` claim in the session JWT — links a token to this row. */
    sessionId: text("session_id").notNull(),
    deviceName: text("device_name"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    sidUq: uniqueIndex("user_sessions_sid_uq").on(t.sessionId),
    userIdx: index("user_sessions_user_idx").on(t.tenantId, t.userId),
    lastSeenIdx: index("user_sessions_lastseen_idx").on(t.tenantId, t.lastSeenAt),
  })
);

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
