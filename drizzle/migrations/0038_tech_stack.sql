-- FEATURE: MFD Tech Stack register (Network FP "MFD Tech Stack").
--
-- The firm's actual tools — name, purpose, owner, access, cost, renewal.
-- Satisfies AMFI DDQ items III.1 (platform used) and VI.4 (software list).
-- Tenant-scoped: RLS below mirrors 0001_rls_policies.sql. Idempotent.

CREATE TABLE IF NOT EXISTS tech_stack_tools (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  category      text NOT NULL DEFAULT 'other',
  tool_name     text NOT NULL,
  purpose       text,
  vendor_url    text,
  owner_user_id uuid REFERENCES users(id),
  access_note   text,
  status        text NOT NULL DEFAULT 'active',
  annual_cost   numeric(14,2),
  renewal_date  date,
  notes         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tech_stack_category_idx ON tech_stack_tools (tenant_id, category);
CREATE INDEX IF NOT EXISTS tech_stack_renewal_idx ON tech_stack_tools (tenant_id, renewal_date);

-- RLS — tenant isolation (app_tenant_id() / app_is_platform_admin() from 0001).
DO $$
BEGIN
  EXECUTE 'ALTER TABLE tech_stack_tools ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE tech_stack_tools FORCE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON tech_stack_tools;';
  EXECUTE 'CREATE POLICY tenant_isolation ON tech_stack_tools FOR ALL '
        || 'USING (tenant_id = app_tenant_id() OR app_is_platform_admin()) '
        || 'WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());';
END$$;
