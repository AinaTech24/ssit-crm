/**
 * One-time password-reset tokens.
 *
 * Stores SHA-256 hash of the token (never the plaintext). 1-hour TTL.
 * Marked consumed on use. Multiple in-flight tokens allowed per user but
 * only one can be consumed.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

export const passwordResets = pgTable(
  "password_resets",
  {
    id,
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestIp: text("request_ip"),
    requestUserAgent: text("request_user_agent"),
    ...timestamps,
  },
  (t) => ({
    tokenIdx: index("password_resets_token_idx").on(t.tokenHash),
    emailIdx: index("password_resets_email_idx").on(t.email),
  })
);

export type PasswordReset = typeof passwordResets.$inferSelect;
