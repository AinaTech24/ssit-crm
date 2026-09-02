-- 0059 — Blueprint "Workflow Advance" hardening
--
-- Two additive schema changes supporting the engine hardening:
--
-- 1. lead_stage_history.entered_by — records WHO opened each stage row, so the
--    current stage's actor is captured (previously only the EXITING row got an
--    actor via completed_by). Null for system/auto/sync moves.
--
-- 2. events_outbox.dedup_key + partial unique index — lets the blueprint engine
--    write one outbox row per stage-history transition occurrence with
--    ON CONFLICT DO NOTHING, so a retried emit can't double-fire stage
--    automations. The index is partial (WHERE dedup_key IS NOT NULL) so the
--    overwhelming majority of outbox rows (which set no key) are unaffected and
--    the hot insert path pays only a cheap predicate check.

ALTER TABLE lead_stage_history
  ADD COLUMN IF NOT EXISTS entered_by uuid REFERENCES users(id);

ALTER TABLE events_outbox
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedup_key_unique
  ON events_outbox (dedup_key)
  WHERE dedup_key IS NOT NULL;
