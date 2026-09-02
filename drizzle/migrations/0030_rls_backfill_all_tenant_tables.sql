-- P0 SECURITY: backfill RLS on EVERY table that has a tenant_id column.
--
-- The audit found financial_plans had NO row-level security at all — a
-- cross-tenant data leak — because it was added after 0001 and never
-- registered in the static tenant_tables array. Several later tables
-- (lead_capture_forms, sub_distributors, legal_registrations,
-- amc_empanelments, product_offerings, firm_directors,
-- suitability_matrix_entries, portfolio_review_items) had ENABLE but not
-- FORCE row level security, so a table owner / superuser path could
-- bypass them.
--
-- This migration is DYNAMIC + idempotent: it discovers every base table
-- in `public` that has a `tenant_id` column and (re)applies the canonical
-- ENABLE + FORCE + tenant_isolation policy using the same app_tenant_id()
-- / app_is_platform_admin() helpers defined in 0001. Re-running it is a
-- no-op. Run it after every new tenant-scoped table ships.
--
-- Platform-shared tables (recipes, packages, content_library_assets) have
-- NO tenant_id column, so they are correctly skipped and keep their own
-- bespoke policies.

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
