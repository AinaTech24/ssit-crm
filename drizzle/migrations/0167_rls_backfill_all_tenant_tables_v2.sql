-- RLS re-backfill (v2) — fixes the "internal error" on permanent-delete (purge).
--
-- Several tenant-scoped tables added AFTER the 0030 backfill shipped with the
-- RAW policy form:  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
-- which has NO platform-admin bypass and CRASHES with "invalid input syntax for
-- type uuid: ''" when app.tenant_id is empty (the withPlatformAdmin / withSystem
-- context). platform_purge_tenant() runs each DELETE under withPlatformAdmin, so
-- those tables threw 22P02 (not a foreign_key_violation, so the purge loop didn't
-- catch it) → the whole purge failed with a generic "internal" error. The same
-- bug also broke public withSystem reads (e.g. /fd financial discoveries).
--
-- This re-runs the canonical 0030 dynamic backfill against the CURRENT schema:
-- every base table with a tenant_id column gets ENABLE + FORCE + the standard
-- admin-aware tenant_isolation policy. Idempotent — safe to re-run.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = app_tenant_id() OR app_is_platform_admin()) '
      'WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());',
      r.table_name
    );
  END LOOP;
END$$;
