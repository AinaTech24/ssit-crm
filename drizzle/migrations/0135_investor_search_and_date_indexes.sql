-- Investor search + date-rule scan indexes.
--
-- Two hot paths on the investors table had no supporting index:
--
-- 1. SEARCH. The client list + the /api/investors search use
--    `name ILIKE '%q%'` (and PAN/email), which a btree index can't serve, so
--    every search was a sequential scan. A pg_trgm GIN index makes the
--    substring search index-backed — the win grows with book size.
--
-- 2. DATE-RULE SCANS. The predefined workflow rules added recently scan
--    investors by `ckyc_expiry_at` (KYC-expiry reminder), `dob` (birthday) and
--    `onboarded_at` (anniversary). None had a (tenant_id, <date>) index, so the
--    daily scanner full-scanned the table per rule. These composite indexes let
--    it range-scan just the due rows.
--
-- All guarded with IF NOT EXISTS so the migration is idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Substring search on name / email (case-insensitive). lower() keeps the index
-- aligned with ILIKE's case-folding.
CREATE INDEX IF NOT EXISTS investors_name_trgm_idx
  ON investors USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS investors_email_trgm_idx
  ON investors USING gin (lower(email) gin_trgm_ops);

-- Date-rule scan anchors (tenant-scoped).
CREATE INDEX IF NOT EXISTS investors_ckyc_expiry_idx
  ON investors (tenant_id, ckyc_expiry_at);
CREATE INDEX IF NOT EXISTS investors_dob_idx
  ON investors (tenant_id, dob);
CREATE INDEX IF NOT EXISTS investors_onboarded_idx
  ON investors (tenant_id, onboarded_at);
