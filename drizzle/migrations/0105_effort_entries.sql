-- 0105 — EFFORTS tracker (Finowise). Monthly Plan vs Actual for leading-activity
-- metrics. One row per (period × metric).

CREATE TABLE IF NOT EXISTS effort_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  period     text NOT NULL,            -- 'YYYY-MM'
  metric_key text NOT NULL,
  planned    numeric(14,2) NOT NULL DEFAULT 0,
  actual     numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS effort_entries_period_idx ON effort_entries (tenant_id, period);
CREATE UNIQUE INDEX IF NOT EXISTS effort_entries_unique ON effort_entries (tenant_id, period, metric_key);

ALTER TABLE effort_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE effort_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON effort_entries;
CREATE POLICY tenant_isolation ON effort_entries FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
