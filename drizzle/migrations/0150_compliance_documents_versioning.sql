-- Document vault: versioning / supersede.
--   superseded_by_id — when a doc is replaced (e.g. a renewed ARN), the OLD row
--                      points to the NEW row's id and is hidden from the vault by
--                      default, while staying queryable for history/audit.
--   version          — monotonically increasing per supersede chain (1, 2, 3…).

ALTER TABLE compliance_documents ADD COLUMN IF NOT EXISTS superseded_by_id uuid;
ALTER TABLE compliance_documents ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;

-- Vault list filters out superseded rows: WHERE tenant_id=? AND superseded_by_id IS NULL.
CREATE INDEX IF NOT EXISTS compliance_docs_active_idx
  ON compliance_documents (tenant_id, created_at)
  WHERE superseded_by_id IS NULL;
