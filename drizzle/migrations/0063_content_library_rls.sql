-- 0063 — content_library_assets: bespoke tenant-isolation RLS policy
--
-- This table is DUAL-PURPOSE: platform-global rows (tenant_id IS NULL, curated
-- by SSIT admins, visible to everyone) AND per-tenant uploads (tenant_id set,
-- private to that MFD). The canonical `tenant_isolation` policy (tenant_id =
-- app.tenant_id) would HIDE the global rows, so this table needs a bespoke
-- predicate: a row is visible iff it's global OR belongs to the current tenant.
--
-- Until now the table had NO policy and RLS was off, so under withTenant the
-- non-admin read returned EVERY tenant's private assets (a cross-tenant leak the
-- routes wrongly assumed RLS prevented). This adds the DB-level backstop; the
-- routes also carry explicit predicates as defense-in-depth.

ALTER TABLE content_library_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_library_assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON content_library_assets;
CREATE POLICY tenant_isolation ON content_library_assets
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
