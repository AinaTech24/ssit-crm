-- 0041 — Persisted client health score (sortable + filterable + automatable)
--
-- clientHealth() (src/lib/investors/health.ts) is an explainable 0–100
-- scorecard, but it was only ever computed in-page — so the investor list
-- could only "sort by health" within the rows already on screen, never across
-- the whole book. Persisting it makes health a first-class column: the list
-- sorts/paginates worst-first at the DB, segments/workflows can target
-- "red-health clients", and the nightly scanner keeps it fresh.
--
--   health_score      integer 0–100 (100 = healthy)
--   health_band       green | amber | red
--   health_scored_at  when last computed (NULL ⇒ never scored ⇒ backfill)
--
-- Default 100/green is the optimistic "unscored ⇒ not at-risk" choice so a
-- brand-new row never raises a false alarm before its first real score.
-- An ascending index on (tenant_id, health_score) makes worst-first an index
-- scan.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS health_band text NOT NULL DEFAULT 'green',
  ADD COLUMN IF NOT EXISTS health_scored_at timestamptz;

CREATE INDEX IF NOT EXISTS investors_health_idx
  ON investors (tenant_id, health_score);
