-- Migration 0016: P1 performance + correctness fixes from PROJECT_AUDIT.md
--
-- 1. events_outbox.attempts: text → integer (so retry increments are
--    atomic via SET attempts = attempts + 1).
-- 2. workflow_runs JSONB expression index for wait_predicate->>'eventKind'.
-- 3. Communications / SR / SIP / blueprint hot compound indexes that
--    weren't present (the existing tx_investor_idx etc. cover most
--    cases — this migration only fills the genuine gaps).
--
-- Pre-flight read of the current schema confirmed:
--   - communications already has comms_investor_idx (tenant_id, investor_id, created_at)
--   - tasks already has tasks_subject_idx (tenant_id, subject_type, subject_id)
--   - service_requests has svc_status_idx + svc_sla_idx
--   - transactions has tx_investor_idx
--   - events_outbox has outbox_unprocessed_idx (partial WHERE processed_at IS NULL)
--
-- So this migration is the *delta* — only the indexes the audit found
-- genuinely missing.

BEGIN;

-- 1. events_outbox.attempts → integer
ALTER TABLE events_outbox ALTER COLUMN attempts DROP DEFAULT;
ALTER TABLE events_outbox
  ALTER COLUMN attempts TYPE integer USING (COALESCE(attempts, '0')::integer);
ALTER TABLE events_outbox ALTER COLUMN attempts SET DEFAULT 0;

-- 2. GIN expression index for workflow run wait predicates
CREATE INDEX IF NOT EXISTS workflow_runs_wait_event_idx
  ON workflow_runs ((wait_predicate->>'eventKind'))
  WHERE wait_predicate IS NOT NULL AND status = 'waiting';

-- 3. communications by lead (already covered for investor)
CREATE INDEX IF NOT EXISTS comms_lead_idx
  ON communications (tenant_id, lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

-- 4. service_requests per investor — list page hot path
CREATE INDEX IF NOT EXISTS svc_investor_idx
  ON service_requests (tenant_id, investor_id, created_at DESC)
  WHERE investor_id IS NOT NULL;

-- 5. tasks open + due_at — assignee dashboard hot path
CREATE INDEX IF NOT EXISTS tasks_open_due_idx
  ON tasks (tenant_id, assignee_id, due_at)
  WHERE status IN ('open', 'in_progress');

-- 6. audit_log by actor for history view (timestamp column is "at")
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (tenant_id, actor_user_id, at DESC);

-- 7. lead_blueprint_instances by lead (engine + designer)
CREATE INDEX IF NOT EXISTS lead_bp_instances_lead_idx
  ON lead_blueprint_instances (lead_id);

COMMIT;
