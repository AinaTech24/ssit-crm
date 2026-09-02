-- 0103 — Direct-Equity (broking) module: DMAT accounts + monthly brokerage.
-- Powers the "Equity Team" MIS (Brokerage · New DMAT · Active Clients). New-DMAT
-- and Active-Client counts derive from opened_date / closed_date; brokerage from
-- one figure per month. Targets live in annual_targets.

CREATE TABLE IF NOT EXISTS equity_dmat_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  investor_id uuid REFERENCES investors(id),
  client_name text NOT NULL,
  dmat_number text,
  broker      text,
  rm_id       uuid REFERENCES users(id),
  opened_date date NOT NULL,
  closed_date date,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equity_dmat_opened_idx ON equity_dmat_accounts (tenant_id, opened_date);
CREATE INDEX IF NOT EXISTS equity_dmat_status_idx ON equity_dmat_accounts (tenant_id, status);

ALTER TABLE equity_dmat_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_dmat_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equity_dmat_accounts;
CREATE POLICY tenant_isolation ON equity_dmat_accounts FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

CREATE TABLE IF NOT EXISTS equity_brokerage (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  period     text NOT NULL,                 -- 'YYYY-MM'
  amount     numeric(18,2) NOT NULL DEFAULT 0,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS equity_brokerage_period_unique ON equity_brokerage (tenant_id, period);

ALTER TABLE equity_brokerage ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_brokerage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equity_brokerage;
CREATE POLICY tenant_isolation ON equity_brokerage FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
