-- OwnerInsightsSection "Automation pulse" counts workflow-created tasks MTD:
--   SELECT COUNT(*) FROM tasks WHERE workflow_run_id IS NOT NULL AND created_at >= start_of_month
--
-- No existing tasks index covers workflow_run_id or created_at, so this
-- seq-scanned the tenant's entire tasks table on every owner dashboard load.
-- A PARTIAL index over only workflow-created tasks stays small (a fraction of
-- all tasks) and turns the MTD count into an index range scan.
--
-- Plain CREATE INDEX (the migrate runner wraps each file in a transaction, so
-- CONCURRENTLY isn't available here). On a large production table, build this
-- CONCURRENTLY by hand instead. Idempotent.

CREATE INDEX IF NOT EXISTS tasks_workflow_run_created_idx
  ON tasks (tenant_id, created_at)
  WHERE workflow_run_id IS NOT NULL;
