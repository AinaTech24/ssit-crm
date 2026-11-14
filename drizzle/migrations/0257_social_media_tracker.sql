-- Social Media Tracker — what the marketing team posted and how it performed.
--
-- One row per piece of content. Type / platform / status are plain text (the allowed
-- values live in the app), so the lists can grow without a migration.

CREATE TABLE IF NOT EXISTS social_media_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  post_date          date NOT NULL,
  content_title      text NOT NULL,
  content_type       text NOT NULL DEFAULT 'post',
  platform           text NOT NULL,
  status             text NOT NULL DEFAULT 'planned',
  post_link          text,
  views              integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  reach              integer NOT NULL DEFAULT 0 CHECK (reach >= 0),
  likes              integer NOT NULL DEFAULT 0 CHECK (likes >= 0),
  followers_increase integer NOT NULL DEFAULT 0,
  leads              integer NOT NULL DEFAULT 0 CHECK (leads >= 0),
  created_by         uuid REFERENCES users(id),
  updated_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_media_posts_date_idx
  ON social_media_posts (tenant_id, post_date);

-- Tenant isolation — the canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the
-- build if this is missing.
ALTER TABLE social_media_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_media_posts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON social_media_posts;
CREATE POLICY tenant_isolation ON social_media_posts FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- A saved permission list (users.permissions), a saved module list
-- (users.enabled_modules) and a package's granular list (packages.enabled_features)
-- are allow-lists, so anything new reads as "unticked" for whoever already has one.
-- Give the new tracker to the marketing team's saved lists. Idempotent (@> guards).
UPDATE users
SET permissions = permissions || '["social_tracker.view"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND 'marketing' = ANY(roles)
  AND NOT permissions @> '["social_tracker.view"]'::jsonb;

UPDATE users
SET permissions = permissions || '["social_tracker.manage"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND 'marketing' = ANY(roles)
  AND NOT permissions @> '["social_tracker.manage"]'::jsonb;

UPDATE users
SET enabled_modules = enabled_modules || '["/dashboard/social-media-tracker"]'::jsonb
WHERE enabled_modules IS NOT NULL
  AND jsonb_typeof(enabled_modules) = 'array'
  AND jsonb_array_length(enabled_modules) > 0
  AND 'marketing' = ANY(roles)
  AND NOT enabled_modules @> '["/dashboard/social-media-tracker"]'::jsonb;

UPDATE packages
SET enabled_features = enabled_features || '["/dashboard/social-media-tracker"]'::jsonb
WHERE jsonb_typeof(enabled_features) = 'array'
  AND jsonb_array_length(enabled_features) > 0
  AND enabled_features @> '["/dashboard/campaigns"]'::jsonb
  AND NOT enabled_features @> '["/dashboard/social-media-tracker"]'::jsonb;
