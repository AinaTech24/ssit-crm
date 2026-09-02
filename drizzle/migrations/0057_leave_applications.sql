-- 0057 — Leave Applications (team HR), adopted from the Sanchay leave module.
--
-- One row per employee leave request: type, date range, duration, computed
-- days, reason, and an approval workflow (requested → approved/rejected, plus
-- applicant cancel). The applicant + approver are `users` (employees). Used for
-- capacity / coverage planning (RMs cover client books).
--
-- New domain table → enable RLS + the standard tenant_isolation policy
-- (mirrors drizzle/migrations/0001_rls_policies.sql, using app_tenant_id()).

CREATE TABLE IF NOT EXISTS leave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  leave_type text NOT NULL,
  duration text NOT NULL DEFAULT 'full_day',
  from_date date NOT NULL,
  to_date date NOT NULL,
  no_of_days numeric(5,1) NOT NULL DEFAULT 1,
  reason text,
  comments text,
  status text NOT NULL DEFAULT 'requested',
  approver_user_id uuid,
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leave_app_status_idx ON leave_applications (tenant_id, status, from_date);
CREATE INDEX IF NOT EXISTS leave_app_employee_idx ON leave_applications (tenant_id, employee_user_id, from_date);
CREATE INDEX IF NOT EXISTS leave_app_range_idx ON leave_applications (tenant_id, from_date, to_date);

ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave_applications;
CREATE POLICY tenant_isolation ON leave_applications FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
