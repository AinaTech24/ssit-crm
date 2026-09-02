-- Fix financial_discoveries RLS so the public "Financial Health Check" (/fd/<token>)
-- can read the record via withSystem (cross-tenant, no app.tenant_id set).
--
-- The original 0157 policy used the raw form:
--     USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
-- which (a) has NO platform-admin/system bypass, so withSystem reads return 0 rows,
-- and (b) CRASHES with "invalid input syntax for type uuid: ''" when app.tenant_id
-- is empty/unset (exactly the withSystem case). Replace it with the codebase-standard
-- helper form used by every other table (app_tenant_id() is empty-safe;
-- app_is_platform_admin() is set true inside withSystem/withAdmin).

ALTER TABLE financial_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_discoveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON financial_discoveries;
CREATE POLICY tenant_isolation ON financial_discoveries FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
