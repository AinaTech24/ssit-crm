-- Content Library enhancements:
--   1. file_size_bytes  text  -> bigint  (numeric, sortable/summable)
--   2. image width/height + an explicit platform-vs-tenant source flag
--   3. a usage-events table (view / cobrand / download / send) for analytics

-- 1) file size as a real number (blank / non-numeric -> NULL)
ALTER TABLE content_library_assets
  ALTER COLUMN file_size_bytes TYPE bigint
  USING NULLIF(regexp_replace(COALESCE(file_size_bytes, ''), '[^0-9]', '', 'g'), '')::bigint;

-- 2) dimensions + source
ALTER TABLE content_library_assets ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE content_library_assets ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE content_library_assets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'platform';
UPDATE content_library_assets
  SET source = CASE WHEN tenant_id IS NULL THEN 'platform' ELSE 'tenant' END;

-- 3) usage events (who used which asset, how)
CREATE TABLE IF NOT EXISTS content_library_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES content_library_assets(id) ON DELETE CASCADE,
  tenant_id uuid,
  user_id uuid,
  event_type text NOT NULL,   -- 'view' | 'cobrand' | 'download' | 'send'
  channel text,               -- 'whatsapp' | 'email' (send only)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cle_asset_idx ON content_library_events (asset_id, event_type);
CREATE INDEX IF NOT EXISTS cle_tenant_idx ON content_library_events (tenant_id);
CREATE INDEX IF NOT EXISTS cle_created_idx ON content_library_events (created_at);

ALTER TABLE content_library_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_library_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_library_events FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
