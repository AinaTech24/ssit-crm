-- 0067 — Cadences / Sequences (enroll + auto-pace), adopted from Zoho CRM.
CREATE TABLE IF NOT EXISTS cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  subject_type text NOT NULL DEFAULT 'lead',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cadences_active_idx ON cadences (tenant_id, subject_type, is_active);
ALTER TABLE cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cadences;
CREATE POLICY tenant_isolation ON cadences FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

CREATE TABLE IF NOT EXISTS cadence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cadence_id uuid NOT NULL,
  subject_type text NOT NULL DEFAULT 'lead',
  subject_id uuid NOT NULL,
  subject_name text,
  current_step integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  next_run_at timestamptz,
  enrolled_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cadence_enrollments_due_idx ON cadence_enrollments (tenant_id, status, next_run_at);
CREATE INDEX IF NOT EXISTS cadence_enrollments_subject_idx ON cadence_enrollments (tenant_id, subject_type, subject_id);
ALTER TABLE cadence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadence_enrollments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cadence_enrollments;
CREATE POLICY tenant_isolation ON cadence_enrollments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
