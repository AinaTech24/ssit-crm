-- Lead search + branch-scope indexes.
--
-- 1. SEARCH. The leads list searches `name ILIKE '%q%'` (plus phone/email),
--    which a btree index can't serve — every search was a sequential scan. A
--    pg_trgm GIN index on lower(name) makes the substring search index-backed.
--
-- 2. BRANCH SCOPE. Branch heads see only their branch's pipeline
--    (leadScopeSql → leads.branch_id = $branch), but there was no
--    (tenant_id, branch_id) index, so their list full-scanned. Add it.
--
-- Idempotent (IF NOT EXISTS). pg_trgm is created idempotently by 0135 too;
-- repeating CREATE EXTENSION IF NOT EXISTS is harmless.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS leads_name_trgm_idx
  ON leads USING gin (lower(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS leads_branch_idx
  ON leads (tenant_id, branch_id);
