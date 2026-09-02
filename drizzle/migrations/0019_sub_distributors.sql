-- Sub-distributors register (SEBI requires parent ARN holders to track
-- every sub-ARN issued under their ARN). Distinct from `users` which is
-- W2 staff with login accounts.
--
-- Network FP "1.2 MFD Sub-Distributors" template parity, extended with:
--   - commission_split_pct (drives brokerage payout calc)
--   - bank_details (jsonb — for actually paying them)
--   - status enum (active/inactive/terminated)
--   - DSC tracking (parallel to the employee licensing model)
--   - relationship_manager_id (which parent-side RM owns the partner)

CREATE TABLE IF NOT EXISTS sub_distributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  code text,
  type_of_association text NOT NULL DEFAULT 'individual',
  city text,
  email text,
  mobile text,
  pan_number text,
  -- Licensing
  nism_cert_no text,
  nism_exam_date date,
  nism_expiry_at date,
  nism_category text,
  arn_number text,
  arn_registration_date date,
  arn_expiry_at date,
  euin text,
  euin_expiry_at date,
  -- Commission + payout
  commission_split_pct numeric(5, 2),
  bank_details jsonb,
  status text NOT NULL DEFAULT 'active',
  onboarded_at date,
  terminated_at date,
  remarks text,
  dsc_on_file boolean DEFAULT false,
  relationship_manager_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sub_distributors_tenant_code_unique
  ON sub_distributors (tenant_id, code)
  WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS sub_distributors_tenant_name_idx
  ON sub_distributors (tenant_id, name);

CREATE INDEX IF NOT EXISTS sub_distributors_tenant_status_idx
  ON sub_distributors (tenant_id, status);

CREATE INDEX IF NOT EXISTS sub_distributors_tenant_arn_idx
  ON sub_distributors (tenant_id, arn_number);

CREATE INDEX IF NOT EXISTS sub_distributors_tenant_rm_idx
  ON sub_distributors (tenant_id, relationship_manager_id);

-- RLS — same tenant_isolation pattern as every other tenant table.
ALTER TABLE sub_distributors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sub_distributors;
CREATE POLICY tenant_isolation ON sub_distributors
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );

-- Optional: link leads to a sub-distributor so the source RM can credit
-- the right channel partner on conversion. Nullable — existing leads
-- don't change.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sub_distributor_id uuid REFERENCES sub_distributors(id);

CREATE INDEX IF NOT EXISTS leads_sub_distributor_idx
  ON leads (tenant_id, sub_distributor_id)
  WHERE sub_distributor_id IS NOT NULL;
