/**
 * Proposal approvals — SEBI-grade acceptance evidence.
 *
 * Captures the artefacts an inspector expects when a client accepts an
 * investment proposal:
 *   - the exact agreed text
 *   - typed-name signature
 *   - IP + user-agent at time of acceptance
 *   - the channel the client used (email / WA / portal / in person)
 *   - the share-token id that gated the link
 *
 * One row per acceptance attempt. The latest non-revoked row per proposal is
 * the "current" approval.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const proposalApprovals = pgTable(
  "proposal_approvals",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    proposalId: uuid("proposal_id").notNull(),

    /** What the client *agreed to* — captured verbatim. */
    acceptanceText: text("acceptance_text").notNull(),

    /** Typed name the client entered as their signature. */
    signatureName: text("signature_name").notNull(),

    /** Channel they accepted from. */
    channel: text("channel", { enum: ["email", "whatsapp", "sms", "portal", "in_person"] })
      .notNull()
      .default("email"),

    /** Evidence — IP, user-agent, optional geo. */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    /** Token that gated the acceptance link (helps audit chain-of-custody). */
    shareTokenId: uuid("share_token_id"),

    /** Optional scanned signed PDF (S3 URL). */
    signedDocumentUrl: text("signed_document_url"),

    /** Optional override + reason (used when RM accepted on behalf of client
     *  in person — extra justification required by some firms). */
    overrideByUserId: uuid("override_by_user_id").references(() => users.id),
    overrideReason: text("override_reason"),

    /** Free-form audit blob (e.g. browser fingerprint, additional UTM data). */
    meta: jsonb("meta"),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    proposalIdx: index("proposal_approvals_proposal_idx").on(t.proposalId, t.acceptedAt),
    tenantIdx: index("proposal_approvals_tenant_idx").on(t.tenantId, t.acceptedAt),
  })
);

export type ProposalApproval = typeof proposalApprovals.$inferSelect;
export type NewProposalApproval = typeof proposalApprovals.$inferInsert;
