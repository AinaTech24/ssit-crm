-- Real file attachments on review meetings.
--
-- Until now a meeting could only carry PASTED URLs in the
-- `review_meetings.attachments` jsonb column ("in a future turn we add a real
-- S3 upload" — ReviewMeetingDetailEditor). This table is that upload: bytes go
-- to S3 under `storage_key` (lib/storage/s3.ts, with its local-disk fallback
-- when no S3 keys are set), the row holds the metadata, and deletes are soft so
-- the audit trail survives.
--
-- Mirrors task_attachments exactly, including the ON DELETE CASCADE so removing
-- a meeting takes its attachment rows with it.

CREATE TABLE IF NOT EXISTS review_meeting_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  meeting_id    uuid NOT NULL REFERENCES review_meetings(id) ON DELETE CASCADE,
  uploaded_by   uuid REFERENCES users(id),
  file_name     text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  storage_key   text NOT NULL,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_meeting_attachments_meeting_idx
  ON review_meeting_attachments (tenant_id, meeting_id, created_at);

-- Tenant isolation — same canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the
-- build if this is missing.
ALTER TABLE review_meeting_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_meeting_attachments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_meeting_attachments;
CREATE POLICY tenant_isolation ON review_meeting_attachments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

COMMENT ON TABLE review_meeting_attachments IS
  'S3-backed documents attached to a review meeting. Supersedes the legacy review_meetings.attachments jsonb URL list.';
