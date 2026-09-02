-- 0117 — Daily Job Tracker (DJT). One reflection/planning row per user per day.
-- The productive/completed + non-productive/incomplete sections are derived from
-- tasks at read time; only the reflective + planning fields are stored here.

CREATE TABLE IF NOT EXISTS daily_trackers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  tracker_date  date NOT NULL,
  key_learning  text,
  breakdown     text,
  breakthrough  text,
  today_focus   jsonb DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_trackers_user_date_unique ON daily_trackers (tenant_id, user_id, tracker_date);
CREATE INDEX IF NOT EXISTS daily_trackers_date_idx ON daily_trackers (tenant_id, tracker_date);

ALTER TABLE daily_trackers ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_trackers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON daily_trackers;
CREATE POLICY tenant_isolation ON daily_trackers FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
