-- FEATURE: per-tenant circular library (MFD's own saved compliance notes).
--
-- Tenant-scoped, standard RLS. The policy matches the canonical tenant_isolation
-- shape from 0030 exactly, so a later dynamic re-run of 0030 is a no-op here and
-- the RLS CI guard passes. Idempotent.

CREATE TABLE IF NOT EXISTS tenant_circulars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  title         text NOT NULL,
  issuer        text,
  category      text,
  summary       text NOT NULL,
  mfd_action    text,
  severity      text NOT NULL DEFAULT 'info',
  source_url    text,
  published_on  date,
  tags          jsonb,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_circulars_tenant_idx ON tenant_circulars (tenant_id, created_at);

ALTER TABLE tenant_circulars ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_circulars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_circulars;
CREATE POLICY tenant_isolation ON tenant_circulars FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
