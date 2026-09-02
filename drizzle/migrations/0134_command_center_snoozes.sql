-- 0134 — Command Center snooze / dismiss.
--
-- Lets each user defer ("remind me tomorrow") or dismiss an item in their
-- Command Center triage queue so noise doesn't reappear every load. Per-user
-- (each person curates their own view); keyed by a stable item key
-- ("<group>:<id>"). buildCommandQueue() left-excludes rows whose key is
-- dismissed or still snoozed.

CREATE TABLE IF NOT EXISTS command_center_snoozes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  item_key text NOT NULL,
  snoozed_until timestamptz,      -- when it should resurface; NULL when dismissed
  dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_snooze_uq
  ON command_center_snoozes (tenant_id, user_id, item_key);
CREATE INDEX IF NOT EXISTS cc_snooze_active_idx
  ON command_center_snoozes (tenant_id, user_id, snoozed_until);

ALTER TABLE command_center_snoozes ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_center_snoozes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON command_center_snoozes FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
