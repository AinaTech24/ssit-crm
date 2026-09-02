import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";

export const consents = pgTable(
  "consents",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),
    channel: text("channel", { enum: ["whatsapp", "email", "sms", "call"] }).notNull(),
    scope: text("scope", { enum: ["transactional", "marketing", "all"] }).notNull(),
    status: text("status", { enum: ["granted", "revoked", "pending"] }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    source: text("source", {
      enum: ["onboarding_form", "wa_optin", "email_doi", "manual", "investor_app", "campaign_form"],
    }),
    evidenceRef: text("evidence_ref"),
    meta: jsonb("meta"),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("consents_unique").on(t.tenantId, t.investorId, t.channel, t.scope),
  })
);

export type Consent = typeof consents.$inferSelect;
export type NewConsent = typeof consents.$inferInsert;
