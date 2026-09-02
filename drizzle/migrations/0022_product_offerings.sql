-- Product / Service offerings — Network FP "1.5 Products / Services
-- Offered" parity. The firm's catalog of what it actually sells, with
-- FK links to the licenses that authorise each offering and the team
-- members trained on it.

CREATE TABLE IF NOT EXISTS product_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  providers jsonb DEFAULT '[]'::jsonb,
  regulator text NOT NULL DEFAULT 'Other',
  linked_registration_ids uuid[] DEFAULT '{}'::uuid[],
  required_exams jsonb DEFAULT '[]'::jsonb,
  team_member_ids uuid[] DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'active',
  launched_at date,
  discontinued_at date,
  documents jsonb DEFAULT '[]'::jsonb,
  remarks text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_offerings_tenant_name_idx
  ON product_offerings (tenant_id, name);

CREATE INDEX IF NOT EXISTS product_offerings_tenant_category_idx
  ON product_offerings (tenant_id, category, status);

CREATE INDEX IF NOT EXISTS product_offerings_tenant_status_idx
  ON product_offerings (tenant_id, status);

ALTER TABLE product_offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON product_offerings;
CREATE POLICY tenant_isolation ON product_offerings
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );
