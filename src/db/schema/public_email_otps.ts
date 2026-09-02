/**
 * Public email OTPs — one active 6-digit code per share token, used by the
 * client-facing public forms (risk profile /r/<token>) to prove the person
 * filling the form controls the email on file.
 *
 * Security model:
 *   - The code is NEVER stored — only sha256(code + ":" + secret).
 *   - One row per token_id (unique) — resends upsert over the same row,
 *     resetting code / expiry / attempts / verified_at.
 *   - Expiry 10 minutes, max 5 wrong attempts, 60s resend cooldown
 *     (enforced in the routes, not the schema).
 *
 * Tenant-scoped with RLS (migration 0173) — public routes resolve the tenant
 * from the share token, then read/write inside withTenant.
 */

import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";

export const publicEmailOtps = pgTable(
  "public_email_otps",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** share_tokens.id this code belongs to — one active code per token. */
    tokenId: uuid("token_id").notNull(),

    /** Destination email the code was sent to (becomes the verified email). */
    email: text("email").notNull(),

    /** sha256 hex of `<code>:<secret>` — plaintext is never persisted. */
    codeHash: text("code_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Wrong-code attempts — 5 strikes and the code is treated as expired. */
    attempts: integer("attempts").notNull().default(0),

    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("public_email_otps_token_uq").on(t.tokenId),
  })
);

export type PublicEmailOtp = typeof publicEmailOtps.$inferSelect;
export type NewPublicEmailOtp = typeof publicEmailOtps.$inferInsert;
