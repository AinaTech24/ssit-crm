-- 0139 — Holiday master. Per-tenant non-working days. The daily attendance
-- auto-seed marks active employees 'holiday' on these dates.

CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  holiday_date date NOT NULL,
  name text NOT NULL,
  is_optional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS holidays_tenant_date_uq
  ON holidays (tenant_id, holiday_date);
CREATE INDEX IF NOT EXISTS holidays_date_idx
  ON holidays (tenant_id, holiday_date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holidays FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
