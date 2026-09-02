-- Soft-delete (Trash bin) for clients (investors).
--
-- Deleting a client no longer hard-deletes it + its folios/transactions/goals
-- (cascade). Instead we stamp deleted_at/deleted_by; the row is hidden from
-- every list and the detail page, surfaced only in the Trash bin, and is
-- auto-purged (permanent hard delete) once the retention window (default 30
-- days, platform_settings.tenant_retention.softDeleteDays) elapses. Recovery is
-- simply clearing deleted_at — all related data is preserved meanwhile.
--
-- Mirrors the existing tenants soft-delete pattern (tenants.deleted_at +
-- daily-ops auto-purge).

ALTER TABLE investors ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Partial index: the Trash listing + the auto-purge scan only touch
-- soft-deleted rows, and every other investor query filters deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS investors_deleted_at_idx
  ON investors (tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
