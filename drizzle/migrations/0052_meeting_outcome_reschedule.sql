-- 0052 — Meetings: outcome capture + reschedule hygiene
--
-- `outcome` / `outcome_notes` already exist in the Drizzle schema but were
-- never surfaced in the API or editor, so the designed outcome→funnel linkage
-- never fired. We (idempotently) ensure the columns exist, then add the
-- reschedule bookkeeping the detail editor now writes:
--   reschedule_count  — how many times the meeting has been moved
--   reschedule_reason — the latest reason (free text)
--
-- All additive on an already-RLS-protected table → no new policy needed.

ALTER TABLE review_meetings
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS outcome_notes text,
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_reason text;
