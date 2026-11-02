-- Dhandho — the firm's daily learning session (speaker rota).
--
-- One row per session date: who speaks, optionally on what. Loaded monthly from
-- an Excel sheet. `reminded_at` makes the "today's speaker" reminder send-once.

CREATE TABLE IF NOT EXISTS dhandho_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  session_date     date NOT NULL,
  speaker_user_id  uuid REFERENCES users(id),
  speaker_name     text NOT NULL,
  topic            text,
  reminded_at      timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dhandho_sessions_date_uq
  ON dhandho_sessions (tenant_id, session_date);

-- Tenant isolation — the canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the
-- build if this is missing.
ALTER TABLE dhandho_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dhandho_sessions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dhandho_sessions;
CREATE POLICY tenant_isolation ON dhandho_sessions FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- The sidebar item is for everyone. A saved per-user list (users.enabled_modules)
-- and a package's granular list (packages.enabled_features) are allow-lists, so a
-- new item reads as "unticked" for anyone who has one. Everyone already has
-- Attendance, so give Dhandho to exactly those lists. Idempotent (@> guards).
UPDATE users
SET enabled_modules = enabled_modules || '["/dashboard/dhandho"]'::jsonb
WHERE enabled_modules IS NOT NULL
  AND jsonb_typeof(enabled_modules) = 'array'
  AND jsonb_array_length(enabled_modules) > 0
  AND enabled_modules @> '["/dashboard/attendance"]'::jsonb
  AND NOT enabled_modules @> '["/dashboard/dhandho"]'::jsonb;

UPDATE packages
SET enabled_features = enabled_features || '["/dashboard/dhandho"]'::jsonb
WHERE jsonb_typeof(enabled_features) = 'array'
  AND jsonb_array_length(enabled_features) > 0
  AND enabled_features @> '["/dashboard/attendance"]'::jsonb
  AND NOT enabled_features @> '["/dashboard/dhandho"]'::jsonb;
