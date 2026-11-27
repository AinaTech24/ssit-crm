-- COB (change of broker) follow-up on a business entry.
--
-- An entry with a COB line is checked 12 days after its business date: the client's RM and the person who
-- executed the transaction are told, and answer Yes (done) or No with the reason.

ALTER TABLE business_entries
  ADD COLUMN IF NOT EXISTS cob_due_on date,
  ADD COLUMN IF NOT EXISTS cob_status text,          -- NULL (no COB) | pending | done | not_done
  ADD COLUMN IF NOT EXISTS cob_reason text,
  ADD COLUMN IF NOT EXISTS cob_answered_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cob_answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cob_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS business_entries_cob_due_idx
  ON business_entries (tenant_id, cob_due_on)
  WHERE cob_status = 'pending';
