-- 0142 — Per-tenant calculator assumptions (house view for default return /
-- inflation that calculators seed with). One row per tenant, India defaults.

CREATE TABLE IF NOT EXISTS calculator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  default_return_pct numeric NOT NULL DEFAULT 12,
  default_inflation_pct numeric NOT NULL DEFAULT 6,
  education_inflation_pct numeric NOT NULL DEFAULT 10,
  debt_return_pct numeric NOT NULL DEFAULT 7,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calculator_settings_tenant_uq
  ON calculator_settings (tenant_id);

ALTER TABLE calculator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calculator_settings FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
