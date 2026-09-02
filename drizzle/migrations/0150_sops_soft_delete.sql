-- Soft-delete for SOPs (compliance integrity).
--
-- Deleting an SOP previously hard-deleted the row, cascaded away every
-- sop_versions row (FK onDelete: cascade), and ORPHANED the
-- sop_acknowledgements (which carry no FK) — destroying the very sign-off
-- evidence the module exists to provide for DDQ readiness / SEBI-AMFI
-- inspection. Instead we now stamp deleted_at/deleted_by; the SOP is hidden
-- from the library + detail page + API, while its versions and the
-- acknowledgements that prove staff signed off are preserved intact.
--
-- Mirrors the investors / rta_imports soft-delete pattern (deleted_at +
-- partial index). sops is an existing tenant table, so its tenant_isolation
-- RLS policy already covers these columns — no policy change needed.

ALTER TABLE sops ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE sops ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Partial index: every live SOP query filters deleted_at IS NULL; a future
-- Trash/restore view would scan only the soft-deleted rows.
CREATE INDEX IF NOT EXISTS sops_deleted_at_idx
  ON sops (tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
