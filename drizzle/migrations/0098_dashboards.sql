-- 0098 — Customizable dashboards ("My Dashboards").
--
-- Each user can build several named boards from the widget catalog, arrange
-- them, set one as default home, and (owner) share a board firm-wide. Layout is
-- a JSON array of placed widgets. Soft delete → Recently Deleted (30-day
-- restore). The role-based cockpit stays the built-in default when a user has
-- no custom default board.

CREATE TABLE IF NOT EXISTS dashboards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid REFERENCES users(id),
  name        text NOT NULL,
  description text,
  scope       text NOT NULL DEFAULT 'private',   -- private | shared
  is_default  boolean NOT NULL DEFAULT false,
  locked      boolean NOT NULL DEFAULT false,
  layout      jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters     jsonb,
  deleted_at  timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboards_tenant_user_idx ON dashboards (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS dashboards_shared_idx      ON dashboards (tenant_id, scope);

-- At most one default board per user among the live (non-deleted) boards.
CREATE UNIQUE INDEX IF NOT EXISTS dashboards_default_unique
  ON dashboards (tenant_id, user_id)
  WHERE is_default = true AND deleted_at IS NULL;

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboards;
CREATE POLICY tenant_isolation ON dashboards FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
