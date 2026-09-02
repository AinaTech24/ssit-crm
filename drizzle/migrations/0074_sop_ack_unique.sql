-- Make SOP acknowledgements idempotent per (sop_version_id, user_id).
--
-- The acknowledge route did SELECT-then-INSERT, so a double-click / race could
-- create duplicate ack rows. The DDQ sopSignoffCoverage calc INNER JOINs on
-- (user_id, sop_version_id), so duplicates inflate the numerator and can push
-- sign-off coverage past 100%. A unique index makes the insert idempotent.

-- 1. Dedup defensively: keep the earliest acknowledgement per (version, user).
DELETE FROM sop_acknowledgements a
USING sop_acknowledgements b
WHERE a.sop_version_id = b.sop_version_id
  AND a.user_id = b.user_id
  AND (a.acknowledged_at > b.acknowledged_at
       OR (a.acknowledged_at = b.acknowledged_at AND a.id > b.id));

-- 2. Enforce uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS sop_ack_version_user_unique
  ON sop_acknowledgements (sop_version_id, user_id);
