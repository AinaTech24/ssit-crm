-- 0064 — Assignment Rules (auto-route new leads/clients to RMs), adopted from
-- Zoho CRM's Assignment Rules. New domain table → RLS + tenant_isolation.

CREATE TABLE IF NOT EXISTS assignment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  subject_type text NOT NULL DEFAULT 'lead',
  strategy text NOT NULL DEFAULT 'round_robin',
  target_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  criteria jsonb DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  rr_cursor integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_rules_active_idx ON assignment_rules (tenant_id, subject_type, is_active, priority);

ALTER TABLE assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assignment_rules;
CREATE POLICY tenant_isolation ON assignment_rules FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
