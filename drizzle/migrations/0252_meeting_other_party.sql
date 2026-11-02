-- Meetings with someone who is neither a client nor a lead.
--
-- A meeting used to need exactly one of investor_id / lead_id. The "Other"
-- option on the schedule form covers everyone else (a prospect's relative, an
-- AMC contact, a vendor…): the name is typed in and stored here, with
-- investor_id and lead_id both NULL. Nullable, nothing back-filled.

ALTER TABLE review_meetings
  ADD COLUMN IF NOT EXISTS other_party_name text;

COMMENT ON COLUMN review_meetings.other_party_name IS
  'Name typed in the "Other" option when the meeting is with neither a client nor a lead.';
