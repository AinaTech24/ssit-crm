-- 0066 — Validation Rules (config data-quality gates), adopted from Zoho CRM.
CREATE TABLE IF NOT EXISTS validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  subject_type text NOT NULL DEFAULT 'lead',
  field text NOT NULL,
  operator text NOT NULL DEFAULT 'required',
  value text,
  applies_when jsonb DEFAULT '{}'::jsonb,
  error_message text NOT NULL,
  severity text NOT NULL DEFAULT 'block',
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS validation_rules_active_idx ON validation_rules (tenant_id, subject_type, is_active);
ALTER TABLE validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON validation_rules;
CREATE POLICY tenant_isolation ON validation_rules FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
