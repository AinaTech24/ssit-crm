-- 0165: firm-wide layout defaults. The owner can save the current page-section
-- arrangement (RelatedLists) and table columns (ColumnManager) as the DEFAULT
-- for the whole firm; individual users still personalize on top (their own
-- localStorage choice wins). One row per (tenant, module_key, kind).
-- Tenant-scoped + RLS (checked by npm run check:rls).

CREATE TABLE IF NOT EXISTS tenant_ui_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  module_key text NOT NULL,
  kind text NOT NULL,          -- 'related_lists' | 'columns'
  data jsonb NOT NULL,         -- related_lists: {order:[],hidden:[]} · columns: string[] (hidden)
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_ui_layouts_uq ON tenant_ui_layouts (tenant_id, module_key, kind);

ALTER TABLE tenant_ui_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ui_layouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_ui_layouts;
CREATE POLICY tenant_isolation ON tenant_ui_layouts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
