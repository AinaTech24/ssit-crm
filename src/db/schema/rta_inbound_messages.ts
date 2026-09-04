/**
 * Inbound RTA mail log — every message the mailback poller touches, routed or not.
 *
 * This is the audit trail behind "did my forwarded mailback actually arrive?".
 * `rta_forward_addresses.last_received_at` only tells you THAT something landed;
 * this table tells you WHAT landed: sender, subject, body snippet, every
 * attachment, and the classification verdict + import outcome for each one.
 *
 * `tenant_id` is nullable on purpose — an unroutable message (bad or rotated
 * address) has no firm to attribute it to. Those rows are visible to platform
 * admins only, via the RLS policy in migration 0192.
 *
 * Written by src/workers/rta-inbox-poller.ts; read by Equitywala Admin → Inbound Mail.
 */

import { integer, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id } from "./_shared";
import { tenants } from "./tenants";

/** What the poller did with the message. */
export type RtaInboundOutcome =
  | "imported" // ≥1 attachment queued for import
  | "duplicate" // recognised, but every attachment was already in flight
  | "confirmation" // Gmail/Outlook forwarding-confirmation mail (carries no data)
  | "no_attachment" // routed to a firm, but nothing importable recognised
  | "unroutable" // no forwarding address matched
  | "error"; // handler threw

/** Per-attachment verdict stored in `attachments`. */
export type RtaInboundAttachmentLog = {
  filename: string;
  size: number;
  /** "cams" | "kfintech" — null when the classifier didn't recognise it. */
  source: string | null;
  /** e.g. "folio_master_dump", "daily_transaction_feed" — null when unrecognised. */
  kind: string | null;
  outcome: "queued" | "duplicate" | "unrecognised" | "error";
  importId?: string | null;
  reason?: string | null;
};

export const rtaInboundMessages = pgTable(
  "rta_inbound_messages",
  {
    id,
    /** Resolved firm — NULL when the mail could not be routed. */
    tenantId: uuid("tenant_id").references(() => tenants.id),
    forwardAddressId: uuid("forward_address_id"),

    messageId: text("message_id"),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    /** The recipient we matched on (or the first seen, when unroutable). */
    toAddress: text("to_address"),
    recipients: jsonb("recipients").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    subject: text("subject"),
    /** First ~2000 chars of the plain-text body — enough to identify the mail. */
    bodySnippet: text("body_snippet"),
    receivedAt: timestamp("received_at", { withTimezone: true }),

    outcome: text("outcome").$type<RtaInboundOutcome>().notNull(),
    reason: text("reason"),

    attachmentCount: integer("attachment_count").default(0).notNull(),
    queuedCount: integer("queued_count").default(0).notNull(),
    duplicateCount: integer("duplicate_count").default(0).notNull(),
    attachments: jsonb("attachments").$type<RtaInboundAttachmentLog[]>().default(sql`'[]'::jsonb`).notNull(),

    /**
     * When the source email was deleted from the catch-all by the cleanup sweep.
     * The log row survives — this table IS the audit trail once the mail is gone.
     */
    mailDeletedAt: timestamp("mail_deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Message-ID is globally unique per RFC 5322 — reprocessing refreshes.
    messageIdUnique: uniqueIndex("rta_inbound_msg_message_id_unique")
      .on(t.messageId)
      .where(sql`message_id IS NOT NULL`),
    createdIdx: index("rta_inbound_msg_created_idx").on(t.createdAt),
    tenantIdx: index("rta_inbound_msg_tenant_idx").on(t.tenantId, t.createdAt),
    outcomeIdx: index("rta_inbound_msg_outcome_idx").on(t.outcome, t.createdAt),
  })
);

export type RtaInboundMessage = typeof rtaInboundMessages.$inferSelect;
export type NewRtaInboundMessage = typeof rtaInboundMessages.$inferInsert;
