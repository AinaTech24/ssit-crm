-- 0060 — Activities (unified interaction log), adopted from the Sanchay
-- "Calls" module + per-record "Check In" (field visit) button.
--
-- One row per logged touchpoint (call / visit / note / message) against a
-- client, lead, or family. Polymorphic subject with denormalised name/phone
-- for join-free list rendering. Geo columns capture the field-visit check-in.
--
-- New domain table → enable RLS + the standard tenant_isolation policy
-- (mirrors drizzle/migrations/0001_rls_policies.sql, using app_tenant_id()).

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  subject_name text,
  subject_phone text,
  kind text NOT NULL DEFAULT 'call',
  direction text,
  status text,
  subject text,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  duration_sec integer,
  geo_lat numeric(10,6),
  geo_lng numeric(10,6),
  location_label text,
  next_followup_at timestamptz,
  owner_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_subject_idx ON activities (tenant_id, subject_type, subject_id, occurred_at);
CREATE INDEX IF NOT EXISTS activities_kind_idx ON activities (tenant_id, kind, occurred_at);
CREATE INDEX IF NOT EXISTS activities_owner_idx ON activities (tenant_id, owner_user_id, occurred_at);
CREATE INDEX IF NOT EXISTS activities_occurred_idx ON activities (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS activities_followup_idx ON activities (tenant_id, next_followup_at);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON activities;
CREATE POLICY tenant_isolation ON activities FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
