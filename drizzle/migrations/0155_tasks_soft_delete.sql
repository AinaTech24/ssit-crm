-- Soft-delete (Trash) for tasks.
--
-- Deleting a task previously hard-removed the row (gone forever, only in the
-- audit log). Now a delete stamps deleted_at/deleted_by; the task is hidden from
-- every task list and surfaced in the Trash module (Tasks section), recoverable
-- by clearing deleted_at, until it's permanently removed from Trash.
--
-- Mirrors the investors / sops soft-delete pattern (deleted_at + partial index).
-- tasks is an existing tenant table, so its tenant_isolation RLS policy already
-- covers these columns — no policy change needed.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Partial index: every live task query filters deleted_at IS NULL; the Trash
-- listing scans only the soft-deleted rows.
CREATE INDEX IF NOT EXISTS tasks_deleted_at_idx
  ON tasks (tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
