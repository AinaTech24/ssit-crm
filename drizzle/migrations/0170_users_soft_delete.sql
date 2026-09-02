-- Employees can be moved to Trash (soft-delete) as an alternative to offboarding.
-- Mirrors the investors/tasks soft-delete columns so the shared Trash UI + restore
-- flow work identically. A trashed user is hidden from the team list and blocked at
-- login; restoring clears these columns and brings the record back intact.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by uuid;
CREATE INDEX IF NOT EXISTS users_tenant_deleted_idx ON users (tenant_id, deleted_at);
