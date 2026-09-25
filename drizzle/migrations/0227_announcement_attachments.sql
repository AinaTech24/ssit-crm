-- Real file attachments on announcements.
--
-- An announcement could only ever be title + body text, so anything it was
-- actually about — the revised process document, a photo of the notice, a
-- short training clip — had to be mailed separately or pasted as a link to
-- somewhere outside the CRM.
--
-- Bytes go to S3 under `storage_key` (lib/storage/s3.ts, with its local-disk
-- fallback when no S3 keys are set), the row holds the metadata, and deletes
-- are soft so the audit trail survives.
--
-- Mirrors task_attachments / review_meeting_attachments exactly, including the
-- ON DELETE CASCADE so removing an announcement takes its files with it. That
-- sameness is what lets all three share one client component and one route
-- contract rather than growing a third variant.

CREATE TABLE IF NOT EXISTS announcement_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  announcement_id  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  uploaded_by      uuid REFERENCES users(id),
  file_name        text NOT NULL,
  content_type     text,
  size_bytes       bigint,
  storage_key      text NOT NULL,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcement_attachments_announcement_idx
  ON announcement_attachments (tenant_id, announcement_id, created_at);

-- Tenant isolation — same canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the
-- build if this is missing.
ALTER TABLE announcement_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_attachments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON announcement_attachments;
CREATE POLICY tenant_isolation ON announcement_attachments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

COMMENT ON TABLE announcement_attachments IS
  'S3-backed documents, images and video attached to an internal announcement.';
