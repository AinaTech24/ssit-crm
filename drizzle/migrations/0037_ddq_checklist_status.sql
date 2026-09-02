-- FEATURE: DDQ audit-checklist status (AMFI Due-Diligence audit readiness).
--
-- Stores the tenant's status + note per AMFI checklist item. The 40-item
-- catalogue lives in code (src/lib/compliance/amfi-ddq-checklist.ts); this
-- table holds only per-tenant status. Tenant-scoped: RLS below mirrors
-- 0001_rls_policies.sql. Idempotent.

CREATE TABLE IF NOT EXISTS ddq_checklist_status (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  item_key    text NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  note        text,
  updated_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ddq_checklist_status_unique
  ON ddq_checklist_status (tenant_id, item_key);
CREATE INDEX IF NOT EXISTS ddq_checklist_status_tenant_idx
  ON ddq_checklist_status (tenant_id);

-- RLS — tenant isolation (app_tenant_id() / app_is_platform_admin() from 0001).
DO $$
BEGIN
  EXECUTE 'ALTER TABLE ddq_checklist_status ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE ddq_checklist_status FORCE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON ddq_checklist_status;';
  EXECUTE 'CREATE POLICY tenant_isolation ON ddq_checklist_status FOR ALL '
        || 'USING (tenant_id = app_tenant_id() OR app_is_platform_admin()) '
        || 'WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());';
END$$;
