-- Workflow Rules: Zoho-parity upgrade.
--
--  1. `branches` — multiple condition sets per rule (Zoho lets one rule hold up
--     to 10 conditions, each with its own actions; first match wins). Empty
--     array = legacy single criteria/actions columns are used.
--  2. Partial index for the time-based scanner (date_field + recurrence rules
--     were previously UI-only — a new worker now fires them).
--
-- Additive + idempotent.

ALTER TABLE workflow_rules
  ADD COLUMN IF NOT EXISTS branches jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS wr_time_rules_idx
  ON workflow_rules (trigger_type, enabled)
  WHERE trigger_type IN ('date_field', 'recurrence');
