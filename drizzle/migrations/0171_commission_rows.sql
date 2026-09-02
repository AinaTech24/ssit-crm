-- commission_rows — the Monthly Brokerage Statement rows the RTA importer has
-- been trying to write all along. The table was never created (only 0093's
-- CONDITIONAL unique index existed), so processBrokerageStatement's soft-skip
-- silently discarded every brokerage upload. This creates the real table with
-- the exact column set the importer INSERTs (src/lib/rta/process.ts ~line 383),
-- the natural-key UNIQUE index 0093 intended (so ON CONFLICT DO NOTHING dedupes
-- a re-imported month), and tenant RLS. Powers Revenue Intelligence.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS commission_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  amc_code text NOT NULL,
  scheme_code text NOT NULL DEFAULT '',
  scheme_name text,
  folio_number text NOT NULL DEFAULT '',
  pan text,
  brokerage_type text NOT NULL DEFAULT 'trail',
  period_start date NOT NULL,
  period_end date NOT NULL,
  aum_amount numeric(18,2),
  brokerage_rate numeric(12,6),
  brokerage_amount numeric(18,2),
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Natural-key dedupe (same definition as 0093's conditional index).
CREATE UNIQUE INDEX IF NOT EXISTS commission_rows_natural_unique
  ON commission_rows (tenant_id, amc_code, scheme_code, folio_number, period_start, period_end, brokerage_type);

CREATE INDEX IF NOT EXISTS commission_rows_tenant_period_idx
  ON commission_rows (tenant_id, period_end DESC);

ALTER TABLE commission_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON commission_rows;
CREATE POLICY tenant_isolation ON commission_rows
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
