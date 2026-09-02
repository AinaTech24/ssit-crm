-- 0138 — Per-tenant attendance policy (work hours, grace, thresholds, week-off).
-- One row per tenant, created lazily with India defaults. Drives late/early-out
-- flags and the daily attendance auto-seed's week-off detection.

CREATE TABLE IF NOT EXISTS attendance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_start text NOT NULL DEFAULT '10:00',
  work_end text NOT NULL DEFAULT '18:30',
  grace_minutes integer NOT NULL DEFAULT 10,
  half_day_minutes integer NOT NULL DEFAULT 240,
  full_day_minutes integer NOT NULL DEFAULT 480,
  week_off_days jsonb NOT NULL DEFAULT '[0]'::jsonb,
  require_geo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_settings_tenant_uq
  ON attendance_settings (tenant_id);

ALTER TABLE attendance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_settings FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
