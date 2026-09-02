-- 0065 — Macros (one-click action bundles), adopted from Zoho CRM Macros.
CREATE TABLE IF NOT EXISTS macros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  subject_type text NOT NULL DEFAULT 'lead',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS macros_active_idx ON macros (tenant_id, subject_type, is_active);
ALTER TABLE macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE macros FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON macros;
CREATE POLICY tenant_isolation ON macros FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
