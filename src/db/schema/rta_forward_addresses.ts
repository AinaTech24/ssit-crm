/**
 * Per-tenant RTA mailback forwarding address.
 *
 * Each MFD forwards their daily CAMS/KFintech mailback email to a UNIQUE address
 * (rta-<token>@<inbound-domain>). A catch-all mailbox is polled by
 * src/workers/rta-inbox-poller.ts, which resolves the tenant from the recipient
 * address via this table (the email analogue of `whatsapp_numbers`), then runs
 * the attachment through the existing rta.import pipeline.
 *
 * The ZIP passwords (separate CAMS + KFintech) live encrypted in
 * `tenant_integrations` (provider "rta_mailback") — see src/lib/rta/mailback-config.ts.
 */

import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const rtaForwardAddresses = pgTable(
  "rta_forward_addresses",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** Full unique inbound address, e.g. rta-a1b2c3d4e5@in.crm.ssit.com */
    address: text("address").notNull(),
    /** Unguessable local-part token (the part after "rta-"). */
    token: text("token").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    /**
     * Mailbox addresses this firm forwards RTA mail FROM (lower-cased). Lets mail
     * sent to the SHARED rta@<domain> address route to this tenant when no
     * per-firm alias matched. Secondary path — the alias always wins.
     */
    sourceAddresses: jsonb("source_addresses").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    /** First time a real mailback landed here — proves forwarding is live. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    /** Auto-captured Gmail/Outlook forwarding confirmation, surfaced in the UI. */
    forwardingConfirmCode: text("forwarding_confirm_code"),
    forwardingConfirmUrl: text("forwarding_confirm_url"),
    forwardingConfirmAt: timestamp("forwarding_confirm_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    addressUnique: uniqueIndex("rta_forward_addr_address_unique").on(t.address),
    tokenUnique: uniqueIndex("rta_forward_addr_token_unique").on(t.token),
    tenantActiveUnique: uniqueIndex("rta_forward_addr_tenant_active_unique")
      .on(t.tenantId)
      .where(sql`is_active`),
    tenantIdx: index("rta_forward_addr_tenant_idx").on(t.tenantId),
  })
);

export type RtaForwardAddress = typeof rtaForwardAddresses.$inferSelect;
export type NewRtaForwardAddress = typeof rtaForwardAddresses.$inferInsert;
