-- Per-device login sessions — powers the "your devices" list, per-device logout,
-- and last-seen presence. Each login inserts a row keyed by the JWT's session id
-- (sid); logout / sign-out-everywhere / deactivate set revoked_at.
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  session_id text NOT NULL,          -- the sid embedded in the session JWT
  device_name text,                  -- parsed from the user-agent (e.g. "Chrome on Windows")
  user_agent text,
  ip_address text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_sid_uq ON user_sessions (session_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS user_sessions_lastseen_idx ON user_sessions (tenant_id, last_seen_at);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_sessions;
CREATE POLICY tenant_isolation ON user_sessions FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
