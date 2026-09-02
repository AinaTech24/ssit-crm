-- Task search + creator-scope indexes.
--
-- 1. SEARCH. The tasks list searches `title ILIKE '%q%'` (plus description),
--    which a btree index can't serve — a sequential scan per search. A pg_trgm
--    GIN index on lower(title) makes the substring search index-backed.
--
-- 2. CREATOR SCOPE. The assigned-only scope predicate is
--    `assignee_id = me OR created_by_id = me`. assignee_id is covered by
--    tasks_assignee_status_idx, but created_by_id had no index, so that half of
--    the OR could not be index-served. Add (tenant_id, created_by_id) so the
--    planner can bitmap-OR both branches.
--
-- Idempotent (IF NOT EXISTS). pg_trgm is created idempotently by 0135/0136 too;
-- repeating CREATE EXTENSION IF NOT EXISTS is harmless.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx
  ON tasks USING gin (lower(title) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tasks_creator_idx
  ON tasks (tenant_id, created_by_id);
