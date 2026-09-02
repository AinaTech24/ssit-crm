/**
 * Share tokens — single-use signed URLs for client-facing public forms.
 *
 * Use cases (kind):
 *   - "risk_profile"        → /r/<token>  client fills the questionnaire
 *   - "document_collection" → /d/<token>  client uploads KYC docs
 *   - "proposal_approval"   → /p/<token>  client accepts a proposal
 *
 * Token plaintext is generated server-side, returned ONCE in the create
 * response so the RM can share it, and stored as SHA-256 hash here. Lookups
 * happen by hash, never by plaintext. Tokens are single-use (we set
 * `used_at` on success) and have a tenant-configurable expiry.
 */

import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const shareTokens = pgTable(
  "share_tokens",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    kind: text("kind", {
      enum: ["risk_profile", "document_collection", "proposal_approval", "onboarding_progress", "portfolio_view", "feedback", "financial_discovery"],
    }).notNull(),

    /** SHA-256 hex of the plaintext token. */
    tokenHash: text("token_hash").notNull(),

    /** What the client will act on. */
    subjectType: text("subject_type", { enum: ["lead", "investor", "proposal"] }).notNull(),
    subjectId: uuid("subject_id").notNull(),

    /**
     * Per-kind config — e.g. for document_collection:
     *   { requiredDocs: [{ key:"pan", label:"PAN card" }, …], extraFields: [...] }
     * For proposal_approval:
     *   { acceptanceText: "I have reviewed and approve this proposal." }
     */
    payload: jsonb("payload"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /** Form-submission outcome — what the client posted back. */
    result: jsonb("result"),

    /** Audit. */
    createdBy: uuid("created_by").references(() => users.id),
    /** Last-known IP / UA from form load — purely informational. */
    lastSeenIp: text("last_seen_ip"),
    lastSeenUserAgent: text("last_seen_user_agent"),

    ...timestamps,
  },
  (t) => ({
    hashUnique: uniqueIndex("share_tokens_hash_unique").on(t.tokenHash),
    subjectIdx: index("share_tokens_subject_idx").on(t.tenantId, t.subjectType, t.subjectId, t.kind),
    expiryIdx: index("share_tokens_expiry_idx").on(t.expiresAt),
  })
);

export type ShareToken = typeof shareTokens.$inferSelect;
export type NewShareToken = typeof shareTokens.$inferInsert;
