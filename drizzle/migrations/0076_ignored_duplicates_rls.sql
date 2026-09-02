-- ignored_duplicates was added without a tenant_isolation policy (it post-dates
-- the 0030 dynamic backfill). It holds per-tenant "these two records are NOT a
-- duplicate" decisions — tenant data — so it needs the canonical policy.
-- Surfaced by `npm run check:rls`. Idempotent.

ALTER TABLE ignored_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ignored_duplicates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ignored_duplicates;
CREATE POLICY tenant_isolation ON ignored_duplicates FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
