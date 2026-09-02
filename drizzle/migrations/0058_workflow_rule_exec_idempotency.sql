-- 0058 — Workflow Rules: per-event idempotency for rule executions
--
-- The rule runner (src/lib/workflow-rules/runner.ts) now CLAIMS an execution
-- row up-front, keyed on (rule_id, trigger_event_id), with ON CONFLICT DO
-- NOTHING, BEFORE it fires any instant action. Instant actions include
-- external sends (email / WhatsApp / SMS), so a re-delivered outbox event —
-- e.g. the outbox poller crashing between "deliver" and "mark processed" —
-- must NOT run them twice. This partial unique index is what makes the claim
-- atomic and idempotent.
--
-- Partial: manual / test executions carry a NULL trigger_event_id and are
-- exempt (multiple manual fires of the same rule are legitimate).

CREATE UNIQUE INDEX IF NOT EXISTS wre_rule_event_unique
  ON workflow_rule_executions (rule_id, trigger_event_id)
  WHERE trigger_event_id IS NOT NULL;
