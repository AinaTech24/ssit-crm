-- SECURITY: business_expenses + business_targets were created in 0036
-- (after the 0030 dynamic RLS backfill) and never received a tenant_isolation
-- policy — so these firm-P&L / revenue tables had NO row-level isolation on a
-- freshly-migrated DB. Apply the canonical policy now. Idempotent.

ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_expenses;
CREATE POLICY tenant_isolation ON business_expenses FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE business_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_targets;
CREATE POLICY tenant_isolation ON business_targets FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
