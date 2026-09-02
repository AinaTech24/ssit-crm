/**
 * User invitation tokens.
 *
 * MFD Owner invites a new team member → row in user_invites with a signed token
 * → invitee receives an email with /accept-invite?token=… link → on accept,
 * we create the user (or activate an existing 'invited' user) and stamp
 * the invite as 'accepted'.
 */

import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const userInvites = pgTable(
  "user_invites",
  {
    id,
    tenantId: tenantId,
    email: text("email").notNull(),
    name: text("name"),
    rolesToGrant: text("roles_to_grant").array().notNull(),
    branchId: uuid("branch_id"),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    tokenHash: text("token_hash").notNull(), // SHA-256 of the random token; we store hash, not plaintext
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    meta: jsonb("meta"),
    ...timestamps,
  },
  (t) => ({
    emailIdx: index("user_invites_email_idx").on(t.tenantId, t.email),
    tokenUnique: uniqueIndex("user_invites_token_unique").on(t.tokenHash),
  })
);

export type UserInvite = typeof userInvites.$inferSelect;
