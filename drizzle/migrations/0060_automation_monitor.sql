-- 0060 — Automation Monitor (Control Tower) hardening
--
-- 1. retry_count on workflow_runs — caps manual re-queues so a deterministically
--    failing run can't be retried forever from the monitor.
-- 2. Composite indexes backing the Control Tower's per-tenant/windowed
--    aggregations, which previously scanned whole tenant histories:
--      - workflow_runs           status rollup + recent failures
--      - communications          outbound delivery rollup
--      - workflow_rule_executions per-tenant execution status (NEW monitor section)
--      - workflow_rule_scheduled_jobs per-tenant job status (NEW monitor section)
--      - events_outbox           pending/stuck backlog via a partial index that
--                                skips processed history entirely

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS wf_runs_tenant_status_created_idx
  ON workflow_runs (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS comms_delivery_idx
  ON communications (tenant_id, direction, status, created_at);

CREATE INDEX IF NOT EXISTS wre_tenant_status_idx
  ON workflow_rule_executions (tenant_id, status, executed_at);

CREATE INDEX IF NOT EXISTS wrsj_tenant_status_idx
  ON workflow_rule_scheduled_jobs (tenant_id, status, run_at);

CREATE INDEX IF NOT EXISTS outbox_tenant_pending_idx
  ON events_outbox (tenant_id, occurred_at)
  WHERE processed_at IS NULL;
