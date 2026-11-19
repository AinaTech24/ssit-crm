-- A client can have several "Referred by" entries, each removable.
--
-- 0261 gave a client ONE referring client (referred_by_investor_id). The Client page now
-- manages a list - add several, remove any - so the list becomes the source of truth:
-- investors.referred_by_investor_ids, a jsonb array of client ids. The single column is
-- kept in step (it holds the first entry) so older readers keep working.
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS referred_by_investor_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Carry across what 0261 already recorded.
UPDATE investors
SET referred_by_investor_ids = jsonb_build_array(referred_by_investor_id::text)
WHERE referred_by_investor_id IS NOT NULL
  AND referred_by_investor_ids = '[]'::jsonb;
