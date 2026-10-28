-- Monthly targets the firm sets for a person, a branch or a desk, per metric
-- (leads, meetings, new clients, tasks, business, AUM, SIP...). Only the TARGET
-- is stored; the achievement is always computed live from the records.
--
--   subject_type  'user' | 'branch' | 'desk'   (branch/desk = every user in it)
--   period        'YYYY-MM'
--   visible       whether the subject (and, for a person, their branch head) is
--                 shown the target and the achievement; the admin always sees all.
CREATE TABLE IF NOT EXISTS target_goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'branch', 'desk')),
  subject_id   uuid NOT NULL,
  metric_key   text NOT NULL,
  period       text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  target_value numeric(20, 2) NOT NULL DEFAULT 0,
  visible      boolean NOT NULL DEFAULT true,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_type, subject_id, metric_key, period)
);

CREATE INDEX IF NOT EXISTS target_goals_lookup_idx ON target_goals (tenant_id, period);

ALTER TABLE target_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE target_goals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON target_goals;
CREATE POLICY tenant_isolation ON target_goals FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
