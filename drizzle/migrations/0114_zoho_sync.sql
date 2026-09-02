-- Zoho CRM sync tables + RLS.
-- Self-contained (CREATE TABLE + ENABLE/FORCE RLS + tenant_isolation policy) so
-- `npm run migrate:all` applies it once and `npm run check:rls` passes. The
-- app_tenant_id() / app_is_platform_admin() helpers come from 0001 (runs first).

CREATE TABLE IF NOT EXISTS zoho_sync_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  zoho_module     text NOT NULL,
  zoho_id         text,
  status          text NOT NULL DEFAULT 'pending',
  last_error      text,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zoho_sync_links_entity_unique
  ON zoho_sync_links (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS zoho_sync_links_tenant_status_idx
  ON zoho_sync_links (tenant_id, status);

CREATE TABLE IF NOT EXISTS zoho_sync_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  last_outbox_id  bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zoho_sync_state_tenant_unique
  ON zoho_sync_state (tenant_id);

-- RLS — same canonical tenant_isolation policy every tenant table carries.
ALTER TABLE zoho_sync_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_sync_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON zoho_sync_links;
CREATE POLICY tenant_isolation ON zoho_sync_links FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE zoho_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_sync_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON zoho_sync_state;
CREATE POLICY tenant_isolation ON zoho_sync_state FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
