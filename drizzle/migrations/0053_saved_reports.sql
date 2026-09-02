-- 0053 — Custom report builder: saved_reports
--
-- User-defined reports over a Filter-AST subject (investor/lead/task/user),
-- rendered as a detailed column table or a matrix (group-by + pivot) cross-tab.
-- Complements the developer-defined MIS catalog; run/export compile the AST to
-- parameterized SQL (same path as segments), so there's no injection surface.

CREATE TABLE IF NOT EXISTS saved_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid REFERENCES branches(id),
  name          text NOT NULL,
  description   text,
  subject       text NOT NULL,
  report_type   text NOT NULL DEFAULT 'detailed',
  ast           jsonb,
  columns       jsonb DEFAULT '[]'::jsonb,
  sort          jsonb,
  matrix        jsonb,
  chart_type    text DEFAULT 'none',
  shared_scope  text NOT NULL DEFAULT 'private',
  created_by_id uuid REFERENCES users(id),
  starred_by    jsonb DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_reports_tenant_idx  ON saved_reports (tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS saved_reports_subject_idx ON saved_reports (tenant_id, subject);
CREATE INDEX IF NOT EXISTS saved_reports_creator_idx ON saved_reports (tenant_id, created_by_id);

-- RLS: tenant isolation (mirrors every other domain table).
ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saved_reports;
CREATE POLICY tenant_isolation ON saved_reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
