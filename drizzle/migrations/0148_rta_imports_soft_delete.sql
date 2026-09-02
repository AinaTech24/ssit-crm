-- Trash bin for RTA file imports: soft-delete a row instead of hard-removing it,
-- so an accidental delete is recoverable. The Recent-uploads list hides
-- deleted_at rows; the Trash view shows them with Recover / Delete-permanently.

ALTER TABLE rta_file_imports ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS rta_imports_deleted_idx
  ON rta_file_imports (tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
