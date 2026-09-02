-- 0060 — Tenant Integrations
--
-- Stores per-tenant integration settings (API keys, auth keys, custom senders)
-- for WhatsApp, SMS, and Email.
-- Encrypted at rest. Scoped by RLS.

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  encrypted_config text NOT NULL,
  sender_config jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_provider_unique ON tenant_integrations (tenant_id, provider);

ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_integrations;
CREATE POLICY tenant_isolation ON tenant_integrations FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
