-- 0052 — Communications: ad-hoc Compose + scheduled send + flag
--
-- The communications log gains an RM-facing Compose flow (free-form email that
-- still passes the consent + compliance gate) and the ability to schedule a
-- send for later. status now also takes 'scheduled' and 'cancelled' (the column
-- is plain TEXT — the enum is enforced in app code — so no type change needed).
--   scheduled_at  — future send time; the scheduled-comms worker drains due rows
--   flagged_at    — user "starred" a row

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz;

-- Cheap drain of due scheduled sends: WHERE status='scheduled' AND scheduled_at <= now()
CREATE INDEX IF NOT EXISTS comms_scheduled_idx
  ON communications (status, scheduled_at);
