-- 0047 — Insurance: lapse-alert marker
--
-- The nightly scanner now emits an `insurance.lapsed` event once when an active
-- policy passes next_premium_due_date + grace_period_days with no payment. This
-- column records that we alerted, so the policy doesn't re-emit every day after
-- (the lapse condition stays true) — one alert per policy, RM confirms.

ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS lapse_alerted_at timestamptz;
