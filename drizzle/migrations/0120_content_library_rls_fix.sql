-- 0120 — fix content_library_assets RLS.
--
-- The 0063 policy cast current_setting('app.tenant_id', true)::uuid directly,
-- which raises "invalid input syntax for type uuid" whenever app.tenant_id is
-- unset — exactly the platform-admin (super-admin) case, where withPlatformAdmin
-- sets app.is_platform_admin but NOT app.tenant_id. Empty string -> ''::uuid ->
-- error -> the /super-admin/content-library page crashed for every platform
-- admin (it worked for MFD users because their app.tenant_id is set).
--
-- Fix: use the NULLIF-guarded app_tenant_id() (empty -> NULL, not an error) and
-- add a platform-admin bypass, matching the canonical tenant_isolation policies.
-- Tenant isolation is preserved: a row is visible iff global, owned, or admin.

DROP POLICY IF EXISTS tenant_isolation ON content_library_assets;
CREATE POLICY tenant_isolation ON content_library_assets
  USING (app_is_platform_admin() OR tenant_id IS NULL OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id IS NULL OR tenant_id = app_tenant_id());
