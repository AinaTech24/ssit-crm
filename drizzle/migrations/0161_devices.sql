-- Mobile push-device registry. One row per (user, physical device); holds the
-- Expo push token the workflow `send_push` action delivers to. New tenant-scoped
-- table with RLS — additive + idempotent.

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  expo_push_token text NOT NULL,
  platform text NOT NULL,
  device_name text,
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-scoped unique (not global): registration UPSERTs on (tenant_id,
-- expo_push_token) so the conflict always lands on a row the RLS policy can see.
-- A global unique would let the conflict row sit in another tenant — invisible
-- to the policy — and ON CONFLICT DO UPDATE would error.
CREATE UNIQUE INDEX IF NOT EXISTS devices_token_unique ON devices (tenant_id, expo_push_token);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (tenant_id, user_id);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON devices;
CREATE POLICY tenant_isolation ON devices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
