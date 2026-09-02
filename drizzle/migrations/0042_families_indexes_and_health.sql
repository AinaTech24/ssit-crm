-- 0042 — Families module: missing indexes + persisted family health
--
-- (1) investors.family_id was unindexed. A Postgres FK does NOT create an
--     index on the referencing column, so every family page / roll-up did a
--     seq scan on investors (WHERE family_id = ?). At 10K investors/tenant
--     that's a full-table scan per family view. Index it tenant-scoped.
--
-- (2) The families table had only its primary key — the list, "review due",
--     "my families" and at-risk queries scanned every family. Add the
--     tenant-scoped lookups they actually use.
--
-- (3) Persist family health (familyHealth() in src/lib/families/health.ts) so
--     the list can sort/filter "worst families first" and segments/workflows
--     can target red-health families — mirroring investor health (0041).
--     Default 100/green is the optimistic "unscored ⇒ not at-risk" choice.

-- (1) The big one — investor lookups by family.
CREATE INDEX IF NOT EXISTS investors_family_idx
  ON investors (tenant_id, family_id);

-- (2) Family-row lookups.
CREATE INDEX IF NOT EXISTS families_rm_idx
  ON families (tenant_id, rm_id);
CREATE INDEX IF NOT EXISTS families_next_review_idx
  ON families (tenant_id, next_review_at);
CREATE INDEX IF NOT EXISTS families_primary_idx
  ON families (tenant_id, primary_investor_id);

-- (3) Persisted family health.
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS health_band text NOT NULL DEFAULT 'green',
  ADD COLUMN IF NOT EXISTS health_scored_at timestamptz;

CREATE INDEX IF NOT EXISTS families_health_idx
  ON families (tenant_id, health_score);
