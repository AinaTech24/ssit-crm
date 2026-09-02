-- Financial Discovery fact-find — one row per client/lead, tenant-scoped with RLS.
-- share_tokens.kind is plain text (no DB CHECK), so the new 'financial_discovery'
-- kind needs no DDL here. Additive + idempotent.

CREATE TABLE IF NOT EXISTS financial_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  title text,
  review_type text,
  status text NOT NULL DEFAULT 'draft',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_score integer,
  assigned_rm_id uuid REFERENCES users(id),
  last_share_token_id uuid,
  shared_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_discovery_subject_idx ON financial_discoveries (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS fin_discovery_status_idx ON financial_discoveries (tenant_id, status);
CREATE INDEX IF NOT EXISTS fin_discovery_score_idx ON financial_discoveries (tenant_id, health_score);

ALTER TABLE financial_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_discoveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON financial_discoveries;
CREATE POLICY tenant_isolation ON financial_discoveries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
