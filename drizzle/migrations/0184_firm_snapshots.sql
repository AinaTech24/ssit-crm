-- Firm history snapshots — one row per tenant per day capturing AUM, active
-- clients, monthly SIP book and active SIP count. Point-in-time market value
-- (AUM) can't be reconstructed from transactions, so history accrues forward
-- from the day the daily recorder starts. Powers the copilot AUM/SIP trend.
-- Raw-SQL only (no Drizzle model) — read by get_aum_trend, written by the
-- daily worker; both use explicit tenant_id, and RLS is the backstop.

CREATE TABLE IF NOT EXISTS firm_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  snapshot_date  date NOT NULL,
  total_aum      numeric(18,2) NOT NULL DEFAULT 0,
  active_clients integer NOT NULL DEFAULT 0,
  monthly_sip    numeric(18,2) NOT NULL DEFAULT 0,
  active_sips    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS firm_snapshots_tenant_date_idx
  ON firm_snapshots (tenant_id, snapshot_date);

ALTER TABLE firm_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON firm_snapshots;
CREATE POLICY tenant_isolation ON firm_snapshots FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
