-- 0040 — Deterministic lead score (persisted + sortable)
--
-- The leads table already had a free-text `score` column that was never
-- reliably populated (the AI advisory endpoint explicitly does not write it).
-- This adds a STRUCTURED, persisted score produced by the deterministic
-- scorecard in src/lib/leads/score.ts, so we can sort "hottest leads first",
-- filter by band, and drive automation off a stable number.
--
--   lead_score   integer 0–100   (the scorecard output)
--   score_band   hot | warm | cold
--   scored_at    when it was last computed (NULL = never scored ⇒ needs backfill)
--
-- A descending index on (tenant_id, lead_score) makes the default
-- "highest score first" board ordering an index scan, not a sort.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_band text NOT NULL DEFAULT 'cold',
  ADD COLUMN IF NOT EXISTS scored_at timestamptz;

CREATE INDEX IF NOT EXISTS leads_score_idx
  ON leads (tenant_id, lead_score DESC);
