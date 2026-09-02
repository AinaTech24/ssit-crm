-- Per-tenant override of which onboarding / KYC form fields are mandatory. The
-- field catalog (src/lib/onboarding/kyc-fields.ts) ships sensible defaults; an
-- admin can flip individual fields required ↔ optional for their firm here.
-- required_overrides is a { fieldKey: boolean } map — an absent key keeps the
-- catalog default. Additive + idempotent, tenant-scoped with RLS.

CREATE TABLE IF NOT EXISTS onboarding_field_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  required_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_field_settings_tenant_uq ON onboarding_field_settings (tenant_id);

ALTER TABLE onboarding_field_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_field_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON onboarding_field_settings;
CREATE POLICY tenant_isolation ON onboarding_field_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
