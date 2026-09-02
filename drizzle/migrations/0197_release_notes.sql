-- "What's new" release notes.
--
-- SSIT ships features continuously, but an MFD had no place in the product to
-- see what changed — so new capability went undiscovered. This is the changelog
-- the app was missing.
--
-- release_notes is PLATFORM-level (no tenant_id, no RLS — same convention as
-- platform_settings): SSIT publishes once, every firm sees it. Read receipts ARE
-- tenant-scoped, because they belong to a user inside a firm.

CREATE TABLE IF NOT EXISTS release_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       text,                              -- optional label, e.g. "Aug 2026"
  title         text NOT NULL,
  body          text NOT NULL,                     -- markdown
  category      text NOT NULL DEFAULT 'feature',   -- feature | improvement | fix | compliance
  module        text,                              -- e.g. "Compliance", "Copilot"
  href          text,                              -- deep-link to the thing that changed
  published_at  timestamptz,                       -- null = draft
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX IF NOT EXISTS release_notes_published_idx ON release_notes (published_at DESC);

-- Per-user read receipts — drives the unread badge.
CREATE TABLE IF NOT EXISTS release_note_reads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL,
  release_note_id uuid NOT NULL REFERENCES release_notes(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS release_note_reads_unique
  ON release_note_reads (tenant_id, user_id, release_note_id);

ALTER TABLE release_note_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_note_reads FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON release_note_reads;
CREATE POLICY tenant_isolation ON release_note_reads FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
