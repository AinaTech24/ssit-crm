import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const tenantIntegrations = pgTable(
  "tenant_integrations",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    // NULL = firm-wide default (owner-managed). Set = that user's personal
    // mailbox (per-RM IMAP/SMTP, or a Gmail / M365 account over OAuth).
    userId: uuid("user_id"),
    provider: text("provider", {
      // "fintech_primitives" is LEGACY — that integration was removed. It stays
      // in the union only so the one surviving stored row still type-checks;
      // no code reads or writes it any more.
      enum: ["resend", "vartify", "msg91", "mailbox", "zoho", "fintech_primitives", "rta_mailback", "calendly"],
    }).notNull(),
    encryptedConfig: text("encrypted_config").notNull(),
    senderConfig: jsonb("sender_config").$type<{
      fromEmail?: string;
      fromName?: string;
      replyTo?: string;
      senderId?: string; // MSG91 Sender ID
      whatsappPhoneE164?: string;
    }>(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    // One firm-wide row per provider …
    tenantLevelUnique: uniqueIndex("tenant_provider_tenant_level_unique")
      .on(t.tenantId, t.provider)
      .where(sql`user_id IS NULL`),
    // … plus one personal row per (user, provider).
    userLevelUnique: uniqueIndex("tenant_provider_user_level_unique")
      .on(t.tenantId, t.userId, t.provider)
      .where(sql`user_id IS NOT NULL`),
  })
);
