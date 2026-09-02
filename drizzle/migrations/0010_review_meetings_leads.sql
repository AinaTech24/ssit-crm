-- ============================================================================
-- 0010 — Allow review meetings to be scheduled against a Lead (not just an
-- Investor). MFDs often meet leads pre-conversion (e.g. discovery / proposal
-- review), so the schema needs to accept either subject.
--
-- Approach: relax investor_id to nullable, add lead_id, enforce "exactly one"
-- via a CHECK constraint.
-- ============================================================================

-- 1) Add lead_id column (FK kept loose — RLS handles cross-tenant)
ALTER TABLE review_meetings
  ADD COLUMN IF NOT EXISTS lead_id UUID;

-- 2) Investor_id was NOT NULL; relax it
ALTER TABLE review_meetings
  ALTER COLUMN investor_id DROP NOT NULL;

-- 3) Exactly one of investor_id / lead_id must be set
ALTER TABLE review_meetings
  DROP CONSTRAINT IF EXISTS review_meetings_subject_xor;
ALTER TABLE review_meetings
  ADD CONSTRAINT review_meetings_subject_xor
  CHECK (
    (investor_id IS NOT NULL AND lead_id IS NULL)
    OR (investor_id IS NULL AND lead_id IS NOT NULL)
  );

-- 4) Index so the leads list page can show "upcoming meetings" badges fast
CREATE INDEX IF NOT EXISTS rm_lead_idx
  ON review_meetings (tenant_id, lead_id, meeting_date)
  WHERE lead_id IS NOT NULL;
