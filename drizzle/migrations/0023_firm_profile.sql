-- Firm profile expansion — Network FP "1.6 Firm Details" template parity.
-- Two parts: extend tenants with the missing scalar fields, and create
-- firm_directors for the multi-entry director / founder / partner list.

-- ── Part 1: extend tenants ────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_structure text,
  ADD COLUMN IF NOT EXISTS incorporation_date date,
  ADD COLUMN IF NOT EXISTS tan text,
  ADD COLUMN IF NOT EXISTS national_distributor_code text,
  ADD COLUMN IF NOT EXISTS primary_din text,
  ADD COLUMN IF NOT EXISTS auditor_name text,
  ADD COLUMN IF NOT EXISTS auditor_frn text,
  ADD COLUMN IF NOT EXISTS bank_account jsonb,
  ADD COLUMN IF NOT EXISTS authorized_signatory jsonb;

-- ── Part 2: firm_directors ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_directors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  role text NOT NULL DEFAULT 'director',
  designation text,
  din text,
  pan_number text,
  email text,
  phone text,
  shareholding_pct numeric(5, 2),
  date_of_appointment date,
  date_of_resignation date,
  status text NOT NULL DEFAULT 'active',
  documents jsonb DEFAULT '[]'::jsonb,
  remarks text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS firm_directors_tenant_status_idx
  ON firm_directors (tenant_id, status);

CREATE INDEX IF NOT EXISTS firm_directors_tenant_role_idx
  ON firm_directors (tenant_id, role);

ALTER TABLE firm_directors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON firm_directors;
CREATE POLICY tenant_isolation ON firm_directors
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );
