-- 0140 — Attendance regularization requests. Employee asks to correct a day's
-- attendance (missed punch / wrongly absent); a manager approves or rejects.
-- On approval the target day's attendance row is updated.

CREATE TABLE IF NOT EXISTS attendance_regularizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  attendance_date date NOT NULL,
  requested_status text NOT NULL DEFAULT 'present',
  requested_clock_in_at timestamptz,
  requested_clock_out_at timestamptz,
  reason text,
  status text NOT NULL DEFAULT 'requested',
  reviewer_user_id uuid,
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS att_reg_status_idx
  ON attendance_regularizations (tenant_id, status, attendance_date);
CREATE INDEX IF NOT EXISTS att_reg_employee_idx
  ON attendance_regularizations (tenant_id, employee_user_id, attendance_date);

ALTER TABLE attendance_regularizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_regularizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_regularizations FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
