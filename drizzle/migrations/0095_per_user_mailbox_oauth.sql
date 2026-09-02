-- 0095 — Per-user mailboxes + OAuth-ready mailbox rows
--
-- Until now tenant_integrations held exactly ONE mailbox per firm (tenant-level,
-- owner-managed). To let each RM connect their own inbox (per-RM IMAP/SMTP, or a
-- Gmail / Microsoft 365 account over OAuth) we make the row optionally user-scoped:
--
--   user_id IS NULL      → the firm-wide default (today's behaviour, owner-managed)
--   user_id IS NOT NULL  → that user's personal mailbox
--
-- The old single (tenant_id, provider) unique would block a per-user mailbox from
-- co-existing with the firm one, so it is replaced by two PARTIAL uniques.
--
-- OAuth refresh tokens (when present) live inside the existing encrypted_config
-- blob (config.oauth.refreshToken) — no plaintext column, same AES-GCM at rest.

ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);

-- Replace the firm-wide (tenant, provider) unique with two partial uniques:
DROP INDEX IF EXISTS tenant_provider_unique;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_provider_tenant_level_unique
  ON tenant_integrations (tenant_id, provider)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_provider_user_level_unique
  ON tenant_integrations (tenant_id, user_id, provider)
  WHERE user_id IS NOT NULL;

-- Helps the poller iterate per-user mailbox rows and the resolver fetch one fast.
CREATE INDEX IF NOT EXISTS tenant_integrations_user_idx
  ON tenant_integrations (tenant_id, user_id, provider);
