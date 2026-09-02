-- Three-way reconciliation — exceptions store.
--
-- The reconciliation-scanner previously only EMITTED events; it never produced
-- a matched, reviewable exception list. This adds the store that the holdings
-- reconciliation engine writes: for each (investor, folio, scheme) it compares
--   • CRM ledger units (Σ inflow − outflow from transactions)            [leg 1]
--   • RTA/CAS-stated units (folios.schemes[].units)                      [leg 2]
--   • live valuation (units × latest AMFI NAV) for materiality           [leg 3]
-- and records any mismatch as an exception an MFD's ops team can work + resolve.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'holdings',
  run_at timestamptz NOT NULL DEFAULT now(),
  scanned integer NOT NULL DEFAULT 0,
  exceptions_found integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_tenant_idx
  ON reconciliation_runs (tenant_id, run_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  run_id uuid,
  investor_id uuid,
  folio_number text,
  scheme_code text,
  scheme_name text,
  -- unit_mismatch | missing_in_crm | missing_in_feed | value_drift
  exception_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',   -- high | medium | low
  crm_units numeric(18,4),
  feed_units numeric(18,4),
  delta_units numeric(18,4),
  crm_value numeric(18,2),
  feed_value numeric(18,2),
  delta_value numeric(18,2),
  -- open | investigating | resolved | ignored
  status text NOT NULL DEFAULT 'open',
  notes text,
  -- stable natural key so re-running reconciliation updates the same row
  dedup_key text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_exceptions_dedup
  ON reconciliation_exceptions (tenant_id, dedup_key);
CREATE INDEX IF NOT EXISTS reconciliation_exceptions_open_idx
  ON reconciliation_exceptions (tenant_id, status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_exceptions_investor_idx
  ON reconciliation_exceptions (tenant_id, investor_id);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reconciliation_runs;
CREATE POLICY tenant_isolation ON reconciliation_runs FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_exceptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reconciliation_exceptions;
CREATE POLICY tenant_isolation ON reconciliation_exceptions FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
