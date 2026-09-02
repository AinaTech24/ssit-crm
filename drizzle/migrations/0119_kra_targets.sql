-- 0119 — per-person KRA targets. One annual target per (user x metric x FY);
-- the scorecard pro-rates it to the selected period for actual-vs-target.

CREATE TABLE IF NOT EXISTS kra_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  fiscal_year   text NOT NULL,
  metric_key    text NOT NULL,
  annual_target numeric(18,2) NOT NULL DEFAULT 0,
  updated_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kra_targets_unique ON kra_targets (tenant_id, user_id, fiscal_year, metric_key);

ALTER TABLE kra_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kra_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kra_targets;
CREATE POLICY tenant_isolation ON kra_targets FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
