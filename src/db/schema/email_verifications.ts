/**
 * One-time email-verification tokens for self-serve signup.
 *
 * Mirrors password_resets: stores only the SHA-256 hash of the token (never
 * the plaintext), has a TTL, and is consumed-once. Issued at signup and on
 * resend; consuming one stamps users.email_verified_at.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

export const emailVerifications = pgTable(
  "email_verifications",
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
    tokenIdx: index("email_verifications_token_idx").on(t.tokenHash),
    emailIdx: index("email_verifications_email_idx").on(t.email),
  })
);

export type EmailVerification = typeof emailVerifications.$inferSelect;
