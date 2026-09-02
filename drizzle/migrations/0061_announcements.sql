-- 0061 — Announcements (internal team notice board), adopted from the Sanchay
-- "Announcements" module.
--
-- Owner / branch-head posted notices, optionally scoped by role + branch, with
-- pin + publish/expiry. Surfaced as a dashboard strip + the Announcements page.
-- Distinct from tenant_circulars (AMFI regulatory digest).
--
-- New domain table → enable RLS + the standard tenant_isolation policy
-- (mirrors drizzle/migrations/0001_rls_policies.sql, using app_tenant_id()).

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  audience_roles jsonb DEFAULT '[]'::jsonb,
  branch_id uuid,
  is_pinned boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_active_idx ON announcements (tenant_id, published_at, expires_at);
CREATE INDEX IF NOT EXISTS announcements_pinned_idx ON announcements (tenant_id, is_pinned);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON announcements;
CREATE POLICY tenant_isolation ON announcements FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
