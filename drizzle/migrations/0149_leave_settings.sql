-- 0149 — Per-tenant leave policy (annual entitlement days per leave type), so a
-- firm sets its own policy instead of the hardcoded defaults. One row per tenant.

CREATE TABLE IF NOT EXISTS leave_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  carry_forward_earned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_settings_tenant_uq ON leave_settings (tenant_id);

ALTER TABLE leave_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_settings FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
