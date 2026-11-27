-- Images and PDFs on a client's notes (Engagement tab). A note may be just its files, with no text.
--
-- One row per file; the bytes live in our storage under storage_key. The note itself is an `activities`
-- row (kind 'note'); deleting it removes its file rows.

CREATE TABLE IF NOT EXISTS client_note_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  activity_id   uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  uploaded_by   uuid REFERENCES users(id),
  file_name     text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL DEFAULT 0,
  storage_key   text NOT NULL,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_note_attachments_note_idx
  ON client_note_attachments (tenant_id, activity_id, created_at);

-- Tenant isolation - the canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the build without it.
ALTER TABLE client_note_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_note_attachments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_note_attachments;
CREATE POLICY tenant_isolation ON client_note_attachments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
