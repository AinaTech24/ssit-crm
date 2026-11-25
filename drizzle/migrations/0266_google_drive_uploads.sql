-- Google Drive hand-off for videos.
--
-- A video is uploaded in the CRM (straight to our storage), then copied in the background
-- to the firm's Google Drive, in a month folder. The Drive link is what the CRM keeps; the
-- staging copy is deleted once Drive has confirmed the file arrived whole.
--
-- drive_uploads is that queue + history: one row per file, with a status the screens poll
-- (pending -> uploading -> done | failed). The Google connection itself (client id / secret /
-- refresh token, encrypted) lives in tenant_integrations, provider 'google_drive'; the provider
-- column is free-text, so nothing changes there.

CREATE TABLE IF NOT EXISTS drive_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  created_by       uuid REFERENCES users(id),
  -- Which screen it came from: 'social_tracker' | 'content_library'.
  source           text NOT NULL DEFAULT 'social_tracker',
  file_name        text NOT NULL,
  content_type     text,
  size_bytes       bigint NOT NULL DEFAULT 0,
  -- Where the staging copy sits in our storage until Drive confirms it.
  storage_key      text,
  -- The month folder is chosen from this day (the post's date), not the upload day.
  folder_date      date NOT NULL DEFAULT current_date,
  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  drive_file_id    text,
  drive_url        text,
  drive_folder     text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX IF NOT EXISTS drive_uploads_tenant_idx
  ON drive_uploads (tenant_id, created_at DESC);

-- Tenant isolation - the canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the build without it.
ALTER TABLE drive_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_uploads FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON drive_uploads;
CREATE POLICY tenant_isolation ON drive_uploads FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- The Drive link of a Social Media Tracker entry's video (the same value on each of the
-- entry's platform lines).
ALTER TABLE social_media_posts
  ADD COLUMN IF NOT EXISTS drive_link text;
