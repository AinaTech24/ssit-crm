-- 0058 — Attendance (team HR), adopted from the Sanchay attendances module
-- (minus the GPS in/out accuracy — not needed for a desk-based MFD team).
--
-- One row per employee per day: status, clock-in/out, total minutes worked.
-- Pairs with leave_applications (approved leave → status 'on_leave') and the
-- daily auto-seed worker. New domain table → RLS + tenant_isolation policy.

CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  attendance_date date NOT NULL,
  status text NOT NULL DEFAULT 'absent',
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  total_minutes integer,
  note text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique ON attendance (tenant_id, employee_user_id, attendance_date);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance (tenant_id, attendance_date, status);
CREATE INDEX IF NOT EXISTS attendance_employee_idx ON attendance (tenant_id, employee_user_id, attendance_date);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance;
CREATE POLICY tenant_isolation ON attendance FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
