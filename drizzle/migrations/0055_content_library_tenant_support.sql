-- Add tenant_id column to content_library_assets
ALTER TABLE content_library_assets ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

-- Create index on tenant_id
CREATE INDEX IF NOT EXISTS cla_tenant_idx ON content_library_assets(tenant_id);

-- Recreate RLS policies
DROP POLICY IF EXISTS cla_read ON content_library_assets;
CREATE POLICY cla_read ON content_library_assets FOR SELECT 
  USING (tenant_id IS NULL OR tenant_id = app_tenant_id() OR app_is_platform_admin());

DROP POLICY IF EXISTS cla_write ON content_library_assets;
CREATE POLICY cla_write ON content_library_assets FOR ALL 
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
