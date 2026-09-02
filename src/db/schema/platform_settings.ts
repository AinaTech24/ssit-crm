import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Global, platform-level key/value config — deliberately NOT tenant-scoped
 * (no tenant_id, no RLS). Only the platform admin (SSIT) writes it; the app
 * reads it at runtime to resolve cross-tenant infrastructure config.
 *
 * Current keys:
 *   'ai' → { provider, apiKeyEnc (AES-256-GCM), fastModel, reasoningModel }
 *           lets the operator switch AI provider/model + rotate the API key
 *           from SSIT Admin without a redeploy. The key is stored ENCRYPTED.
 */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});
