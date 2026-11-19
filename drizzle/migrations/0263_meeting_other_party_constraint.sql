-- Let "Other" meetings be saved.
--
-- Migration 0252 added review_meetings.other_party_name for meetings with someone who
-- is neither a client nor a lead, and the API now writes such rows with investor_id and
-- lead_id BOTH null. But the CHECK from 0010 (review_meetings_subject_xor) still
-- demands exactly one of investor_id / lead_id, so every "Other" meeting was rejected
-- by the database and the schedule form showed a bare "internal" error.
--
-- New rule: never BOTH a client and a lead, and at least one of client / lead / a typed
-- name. Every existing row (exactly one of client / lead) satisfies it, so the
-- constraint is added already-validated.
ALTER TABLE review_meetings DROP CONSTRAINT IF EXISTS review_meetings_subject_xor;
ALTER TABLE review_meetings
  ADD CONSTRAINT review_meetings_subject_xor
  CHECK (
    NOT (investor_id IS NOT NULL AND lead_id IS NOT NULL)
    AND (investor_id IS NOT NULL OR lead_id IS NOT NULL OR other_party_name IS NOT NULL)
  );
