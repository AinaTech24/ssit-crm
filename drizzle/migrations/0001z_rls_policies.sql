-- FILENAME NOTE: the "z" is load-bearing. migrate-all.ts applies files in
-- filename sort order, and this migration ALTERs tables that 0001_sleepy_joseph.sql
-- creates. Named 0001_rls_policies.sql it sorted BEFORE that file ("r" < "s") and
-- a fresh database could never be bootstrapped: it died on ALTER TABLE branches.
-- Do not rename it back without re-checking the sort order.
-- Row-Level Security policies for multi-tenant isolation.
-- This migration MUST run after the Drizzle-generated schema migration.
--
-- Every domain table that has `tenant_id` gets:
--   1. RLS enabled
--   2. A policy that scopes reads/writes by tenant_id, with bypass for SSIT
--      platform admins (so they can manage all MFD accounts).
--
-- Application code uses one of three helpers in src/db/client.ts:
--   withTenant(tenantId, ...)         — sets app.tenant_id, normal MFD user
--   withPlatformAdmin(adminUserId, …) — sets app.is_platform_admin=true, SSIT
--   withSystem(...)                   — bypasses RLS entirely (workers, signup)

-- ============================================================================
-- Session-variable helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION app_tenant_id()
RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_user_id()
RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_is_platform_admin()
RETURNS boolean AS $$
  SELECT COALESCE(current_setting('app.is_platform_admin', true) = 'true', false);
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- Tenant-scoped tables: read/write iff (tenant_id = app_tenant_id())
--                                      OR (caller is platform admin)
-- ============================================================================

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'branches',
    'users',
    'families',
    'investors',
    'folios',
    'transactions',
    'mandates',
    'sips',
    'leads',
    'tasks',
    'goals',
    'workflows',
    'workflow_versions',
    'workflow_triggers',
    'workflow_runs',
    'workflow_run_steps',
    'segments',
    'segment_memberships',
    'templates',
    'template_versions',
    'template_approvals',
    'whatsapp_templates',
    'communications',
    'whatsapp_numbers',
    'consents',
    'campaigns',
    'events_outbox',
    'audit_log',
    'service_requests',
    'compliance_documents',
    'ddq_scores',
    'sops',
    'sop_versions',
    'sop_acknowledgements',
    'master_values',
    'amc_master',
    'scheme_master',
    'subscriptions',
    'subscription_events',
    'support_tickets',
    'user_invites',
    'amc_payouts',
    'commission_records',
    'notifications',
    'password_resets',
    'onboarding_pipelines',
    'risk_profile_responses',
    'sip_rejections',
    'review_meetings',
    'proposals',
    'insurance_policies',
    'content_posts',
    'workflow_rules',
    'workflow_rule_executions',
    'workflow_rule_scheduled_jobs',
    'tenant_integrations',
    'ignored_duplicates',
    'investor_portal_access',
    'business_impacts'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I;', t
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = app_tenant_id() OR app_is_platform_admin()) '
      'WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());',
      t
    );
  END LOOP;
END$$;

-- ============================================================================
-- Tenants table: a user sees only their tenant row. Platform admin sees all.
-- ============================================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants FOR ALL
  USING (id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (id = app_tenant_id() OR app_is_platform_admin());

-- ============================================================================
-- Platform-scoped tables: recipes + packages globally readable; only platform
-- admin can write.
-- ============================================================================
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipes_read ON recipes;
CREATE POLICY recipes_read ON recipes FOR SELECT USING (true);
DROP POLICY IF EXISTS recipes_write ON recipes;
CREATE POLICY recipes_write ON recipes FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packages_read ON packages;
CREATE POLICY packages_read ON packages FOR SELECT USING (true);
DROP POLICY IF EXISTS packages_write ON packages;
CREATE POLICY packages_write ON packages FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- SSIT content library — every tenant SELECTs, only platform admins write.
ALTER TABLE content_library_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cla_read ON content_library_assets;
CREATE POLICY cla_read ON content_library_assets FOR SELECT USING (true);
DROP POLICY IF EXISTS cla_write ON content_library_assets;
CREATE POLICY cla_write ON content_library_assets FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
