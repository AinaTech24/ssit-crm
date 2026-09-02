-- 0054 — Custom reports: email schedule
--
-- Lets a saved report be emailed to a list of recipients on a daily / weekly /
-- monthly cadence. The report-scheduler worker ticks hourly, finds due reports,
-- renders them, and sends an HTML summary via the email adapter. last_sent_at
-- is the dedup guard so a report fires at most once per occurrence.

ALTER TABLE saved_reports
  ADD COLUMN IF NOT EXISTS schedule     jsonb,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

-- Partial index for the scheduler's due-query (only scheduled+enabled rows).
CREATE INDEX IF NOT EXISTS saved_reports_schedule_idx
  ON saved_reports (((schedule->>'hour')))
  WHERE schedule IS NOT NULL AND (schedule->>'enabled') = 'true';
