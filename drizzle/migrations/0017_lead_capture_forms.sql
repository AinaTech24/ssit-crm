-- Lead capture forms (Sprint 3 #15)
-- Tenant-configurable public web forms that POST a new lead.
-- Public URL pattern: /lf/<slug>  — slug is globally unique (MFDs paste
-- the URL into their own website without exposing the tenant ID).

CREATE TABLE IF NOT EXISTS lead_capture_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  fields jsonb DEFAULT '[]'::jsonb,
  default_rm_id text,
  lead_source text NOT NULL DEFAULT 'website',
  source_campaign text,
  branding jsonb,
  enabled boolean NOT NULL DEFAULT true,
  rate_limit_per_hour text DEFAULT '5',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_capture_forms_slug_unique
  ON lead_capture_forms (slug);

CREATE INDEX IF NOT EXISTS lead_capture_forms_tenant_idx
  ON lead_capture_forms (tenant_id, enabled);

-- RLS — same pattern as every other tenant table.
ALTER TABLE lead_capture_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON lead_capture_forms;
CREATE POLICY tenant_isolation ON lead_capture_forms
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );
