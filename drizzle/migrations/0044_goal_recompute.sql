-- 0044 — Goal planning: nightly-recompute support + missing indexes
--
-- (1) expected_progress_pct — the time-elapsed trajectory a goal SHOULD be at
--     (months elapsed / total months). The goal_drift_alert recipe triggers on
--     `progress_pct < expected_progress_pct - 10`, but this column never
--     existed and no worker populated it, so the marquee retention alert could
--     never fire. The nightly recompute now writes both progress_pct (from
--     current value) and expected_progress_pct here.
--
-- (2) Indexes — goals only had (tenant_id, investor_id). The review recipe,
--     "reviews due", status filters and target-date ordering all scanned the
--     whole table. Add the tenant-scoped lookups they use.

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS expected_progress_pct numeric(5, 2);

CREATE INDEX IF NOT EXISTS goals_next_review_idx
  ON goals (tenant_id, next_review_at);
CREATE INDEX IF NOT EXISTS goals_status_idx
  ON goals (tenant_id, status);
CREATE INDEX IF NOT EXISTS goals_target_date_idx
  ON goals (tenant_id, target_date);
