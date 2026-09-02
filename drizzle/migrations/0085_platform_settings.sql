-- Global, platform-level key/value settings (NOT tenant-scoped → no RLS).
-- Holds the AI provider config: { provider, apiKeyEnc (AES-256-GCM), fastModel,
-- reasoningModel } under key 'ai', so the operator can switch model/provider and
-- rotate the API key from SSIT Admin without a redeploy. The key is encrypted.
-- Idempotent: db:push creates this on a fresh DB; this no-ops if it exists.
CREATE TABLE IF NOT EXISTS platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
