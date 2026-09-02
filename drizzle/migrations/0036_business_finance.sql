-- FEATURE: firm business-finance tables (Network FP Module 8).
--
--   business_expenses — line-item expense ledger (8.2). Income lives in
--                       commission_records / amc_payouts; together they feed
--                       the firm P&L (8.3).
--   business_targets  — firm-level annual targets per metric per FY (8.5).
--
-- Both are tenant-scoped: RLS enabled + tenant_isolation policy below, matching
-- the pattern in 0001_rls_policies.sql. Idempotent.

CREATE TABLE IF NOT EXISTS business_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  expense_date  date NOT NULL,
  description   text NOT NULL,
  category      text NOT NULL DEFAULT 'others',
  paid_from     text NOT NULL DEFAULT 'current_account',
  amount        numeric(18,2) NOT NULL,
  notes         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_expenses_date_idx
  ON business_expenses (tenant_id, expense_date);
CREATE INDEX IF NOT EXISTS business_expenses_category_idx
  ON business_expenses (tenant_id, category);

CREATE TABLE IF NOT EXISTS business_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  fiscal_year   text NOT NULL,
  metric        text NOT NULL,
  annual_target numeric(18,2) NOT NULL DEFAULT 0,
  updated_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_targets_unique
  ON business_targets (tenant_id, fiscal_year, metric);
CREATE INDEX IF NOT EXISTS business_targets_fy_idx
  ON business_targets (tenant_id, fiscal_year);

-- ---------------------------------------------------------------------------
-- RLS — tenant isolation (mirrors 0001_rls_policies.sql). app_tenant_id() and
-- app_is_platform_admin() are created in 0001 and already exist.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  finance_tables text[] := ARRAY['business_expenses', 'business_targets'];
BEGIN
  FOREACH t IN ARRAY finance_tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = app_tenant_id() OR app_is_platform_admin()) '
      'WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());',
      t
    );
  END LOOP;
END$$;
