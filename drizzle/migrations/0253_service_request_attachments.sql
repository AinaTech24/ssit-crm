-- Document attachments on service requests.
--
-- A request could not carry files at all. This table is the upload: bytes go to
-- S3 under `storage_key` (lib/storage/s3.ts, local-disk fallback when no S3 keys
-- are set), the row holds the metadata, and deletes are soft so the audit trail
-- survives. Mirrors review_meeting_attachments (0201), including ON DELETE
-- CASCADE so removing a request takes its attachment rows with it.

CREATE TABLE IF NOT EXISTS service_request_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploaded_by         uuid REFERENCES users(id),
  file_name           text NOT NULL,
  content_type        text,
  size_bytes          bigint,
  storage_key         text NOT NULL,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_request_attachments_request_idx
  ON service_request_attachments (tenant_id, service_request_id, created_at);

-- Tenant isolation — the canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the
-- build if this is missing.
ALTER TABLE service_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_request_attachments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_request_attachments;
CREATE POLICY tenant_isolation ON service_request_attachments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

COMMENT ON TABLE service_request_attachments IS
  'S3-backed documents attached to a service request.';
