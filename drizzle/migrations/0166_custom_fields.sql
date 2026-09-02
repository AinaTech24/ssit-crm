-- 0166: MFD-defined custom fields. Each firm defines its own extra fields on
-- leads / clients; values live in a jsonb bag on the record. Additive + RLS.

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity text NOT NULL,                 -- 'lead' | 'investor'
  key text NOT NULL,                    -- stable machine key (snake_case)
  label text NOT NULL,
  type text NOT NULL,                   -- text|textarea|number|date|select|checkbox
  options jsonb,                        -- string[] for select
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_defs_uq ON custom_field_defs (tenant_id, entity, key);
CREATE INDEX IF NOT EXISTS custom_field_defs_entity_idx ON custom_field_defs (tenant_id, entity, sort_order);

ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON custom_field_defs;
CREATE POLICY tenant_isolation ON custom_field_defs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Value bags on the records.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields jsonb;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS custom_fields jsonb;
