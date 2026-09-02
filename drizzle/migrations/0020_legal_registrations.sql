-- Legal Registrations register — Network FP "1.3 Legal Registrations"
-- template parity. Tracks every statutory + regulatory registration the
-- firm holds (SEBI / AMFI / IRDAI / GST / MCA / etc.), with renewal
-- cadence + expiry + document links.

CREATE TABLE IF NOT EXISTS legal_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  registered_in_name_of text NOT NULL,
  authority text NOT NULL DEFAULT 'Other',
  authority_other text,
  registration_for text NOT NULL,
  registration_number text,
  registration_date date,
  expiry_at date,
  renewal_frequency text NOT NULL DEFAULT 'annual',
  renewal_details text,
  status text NOT NULL DEFAULT 'active',
  documents jsonb DEFAULT '[]'::jsonb,
  remarks text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_reg_tenant_status_idx
  ON legal_registrations (tenant_id, status);

CREATE INDEX IF NOT EXISTS legal_reg_authority_idx
  ON legal_registrations (tenant_id, authority);

CREATE INDEX IF NOT EXISTS legal_reg_expiry_idx
  ON legal_registrations (tenant_id, expiry_at);

-- RLS — same tenant_isolation pattern.
ALTER TABLE legal_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON legal_registrations;
CREATE POLICY tenant_isolation ON legal_registrations
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );
