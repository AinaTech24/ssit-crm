/**
 * webhook_events — idempotency ledger for at-least-once webhook providers
 * (Razorpay, …). One row per (provider, event_id); the handler inserts inside
 * its processing transaction with ON CONFLICT DO NOTHING and skips on a
 * duplicate. Platform-infra: NO tenant_id / NO RLS (webhooks run in system
 * context, like scheme_nav). See migration 0154.
 */

import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerEventUnique: uniqueIndex("webhook_events_provider_event_unique").on(t.provider, t.eventId),
  })
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
