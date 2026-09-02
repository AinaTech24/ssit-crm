-- 0102 — Annual (FY) targets for the "Target vs Actual" monthly-meeting reports
-- (SIF business, Direct-Equity "Planned 26-27", etc.). Actuals compute live;
-- only the target is stored. Keyed by (metric_key × fiscal_year × scope), where
-- scope is firm / branch / desk.

CREATE TABLE IF NOT EXISTS annual_targets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  metric_key   text NOT NULL,
  fiscal_year  text NOT NULL,                          -- 'YYYY-YY'
  scope_type   text NOT NULL,                          -- firm | branch | desk
  scope_id     uuid,                                   -- branch/desk id; null for firm
  target_value numeric(20,2) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annual_targets_lookup_idx
  ON annual_targets (tenant_id, metric_key, fiscal_year);

-- One row per scope. Firm scope (scope_id IS NULL) is unique on the scope_type;
-- branch/desk scope is unique on the scope_id.
CREATE UNIQUE INDEX IF NOT EXISTS annual_targets_firm_unique
  ON annual_targets (tenant_id, metric_key, fiscal_year, scope_type)
  WHERE scope_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS annual_targets_scope_unique
  ON annual_targets (tenant_id, metric_key, fiscal_year, scope_type, scope_id)
  WHERE scope_id IS NOT NULL;

ALTER TABLE annual_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE annual_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON annual_targets;
CREATE POLICY tenant_isolation ON annual_targets FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
