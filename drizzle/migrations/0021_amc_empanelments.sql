-- AMC Empanelments register — Network FP "1.4 AMC Empanelments" parity.
-- Tracks per-(tenant × AMC) relationship: empanelment date, RM / Ops /
-- Escalation contact tree, distributor code, trail-rate override that
-- feeds the brokerage reconciler.

CREATE TABLE IF NOT EXISTS amc_empanelments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  amc_code text NOT NULL,
  amc_name text NOT NULL,
  distributor_code text,
  empanelment_date date,
  status text NOT NULL DEFAULT 'empanelled',
  terminated_at date,
  rm_name text,
  rm_email text,
  rm_phone text,
  ops_name text,
  ops_email text,
  ops_phone text,
  escalation_name text,
  escalation_email text,
  escalation_phone text,
  additional_contacts jsonb DEFAULT '[]'::jsonb,
  portal_url text,
  trail_rate_override_pct numeric(6, 4),
  documents jsonb DEFAULT '[]'::jsonb,
  remarks text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS amc_empanelments_tenant_amc_unique
  ON amc_empanelments (tenant_id, amc_code);

CREATE INDEX IF NOT EXISTS amc_empanelments_tenant_status_idx
  ON amc_empanelments (tenant_id, status);

CREATE INDEX IF NOT EXISTS amc_empanelments_tenant_date_idx
  ON amc_empanelments (tenant_id, empanelment_date);

ALTER TABLE amc_empanelments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON amc_empanelments;
CREATE POLICY tenant_isolation ON amc_empanelments
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );
