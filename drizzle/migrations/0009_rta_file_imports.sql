-- ============================================================================
-- 0009 — RTA file imports
--
-- Tracks every flat file ingested from CAMS / KFintech / MFU / exchanges.
-- One row per upload. Drives the dashboard's "last uploaded / next expected /
-- late by N days" tiles, and the audit trail for reconciliation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rta_file_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  source          TEXT NOT NULL,    -- cams | kfintech | mfu | bse_star_mf | nse_nmf2
  kind            TEXT NOT NULL,    -- see RTA_FILE_KINDS in src/db/schema/rta_imports.ts
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,

  file_name       TEXT NOT NULL,
  file_key        TEXT NOT NULL,    -- object-storage key
  file_size_bytes INTEGER,
  file_checksum   TEXT,             -- sha256, dedupe across re-uploads

  status          TEXT NOT NULL DEFAULT 'uploaded',
  parsed_at       TIMESTAMPTZ,

  rows_total      INTEGER,
  rows_imported   INTEGER,
  rows_skipped    INTEGER,
  rows_failed     INTEGER,
  errors          JSONB,
  remarks         TEXT,

  uploaded_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rta_imports_kind_idx
  ON rta_file_imports (tenant_id, kind, period_end DESC);
CREATE INDEX IF NOT EXISTS rta_imports_status_idx
  ON rta_file_imports (tenant_id, status);
CREATE INDEX IF NOT EXISTS rta_imports_dedupe_idx
  ON rta_file_imports (tenant_id, source, kind, period_end, file_checksum);

-- RLS — every row scoped to its tenant.
ALTER TABLE rta_file_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_file_imports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rta_file_imports_tenant_isolation ON rta_file_imports;
CREATE POLICY rta_file_imports_tenant_isolation ON rta_file_imports
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true) = 'true'
  );
