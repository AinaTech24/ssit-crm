-- Leads get a real soft delete, and can therefore be permanently deleted.
--
-- Deleting a lead used to stamp lost_reason = '__deleted__' and force the stage
-- to 'not_qualified' — a sentinel standing in for the deleted_at column this
-- migration finally adds (the DELETE route said as much in a comment). Two
-- things went wrong with that:
--
--   1. Every list had to remember to filter the sentinel. The duplicate scanner
--      did not, so a deleted lead kept blocking re-entry of the same person.
--   2. There was no way to remove one for good. Trash is built on deleted_at,
--      so leads could not appear in it, could not be restored, and could not be
--      purged. "Deleted" leads accumulated forever.
--
-- The sentinel is NOT removed: existing code still writes and reads it, and
-- ripping it out in the same change that introduces the column would turn a
-- reversible migration into a risky one. deleted_at is now the source of truth;
-- the sentinel is a mirror, and can be retired once nothing reads it.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);

-- Back-fill everything already deleted under the sentinel, so those leads show
-- up in Trash instead of being stranded — invisible in lists, unpurgeable, but
-- still tripping the duplicate warning.
UPDATE leads
   SET deleted_at = COALESCE(lost_at, updated_at, now())
 WHERE lost_reason = '__deleted__'
   AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS leads_deleted_idx
  ON leads (tenant_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- A purge must actually be able to delete the row. Three tables reference
-- leads with NO ACTION, which would make every permanent delete fail on the
-- first lead that had ever been emailed or quoted. Cascade matches how the
-- client subgraph already behaves (migration 0131): the lead is gone, so the
-- proposals and the message log that belong to it go with it.
ALTER TABLE communications  DROP CONSTRAINT IF EXISTS communications_lead_id_leads_id_fk;
ALTER TABLE communications  ADD  CONSTRAINT communications_lead_id_leads_id_fk
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE financial_plans DROP CONSTRAINT IF EXISTS financial_plans_lead_id_leads_id_fk;
ALTER TABLE financial_plans ADD  CONSTRAINT financial_plans_lead_id_leads_id_fk
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE proposals      DROP CONSTRAINT IF EXISTS proposals_lead_id_leads_id_fk;
ALTER TABLE proposals      ADD  CONSTRAINT proposals_lead_id_leads_id_fk
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

COMMENT ON COLUMN leads.deleted_at IS
  'Soft delete. Source of truth; lost_reason = ''__deleted__'' is a legacy mirror kept for older readers.';
