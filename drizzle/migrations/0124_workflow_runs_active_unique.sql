-- 0124 — prevent duplicate concurrent workflow runs for the same subject.
--
-- startRun() documented that it "relies on the unique partial index on
-- workflow_runs", but that index never existed — the recurrence guard was a
-- non-atomic SELECT-then-INSERT. Two events for the same subject arriving close
-- together (very common: an inbound webhook + the daily scanner both touch one
-- investor) both pass the SELECT and both INSERT, producing duplicate runs and
-- therefore duplicate downstream sends.
--
-- This partial unique index makes "one ACTIVE run per (tenant, workflow,
-- subject)" a hard DB invariant. startRun now catches the unique violation and
-- returns the existing active run instead. Subject-less runs (subject_id NULL,
-- e.g. schedule-for-all) are exempt — NULLs are distinct, so they never collide.

CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_active_subject_uniq
  ON workflow_runs (tenant_id, workflow_id, subject_type, subject_id)
  WHERE status IN ('queued', 'running', 'paused') AND subject_id IS NOT NULL;
