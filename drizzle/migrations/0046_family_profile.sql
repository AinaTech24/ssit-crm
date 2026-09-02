-- Family profile fields adopted from the Sanchay "Create Family/Organization"
-- form: a human-friendly code, a category/segment, and a review cadence
-- (meeting frequency + first meeting date) that auto-drives next_review_at.
--
-- `families` is already an RLS-protected domain table (tenant_isolation policy
-- covers all columns), so these additive columns need no new policy.

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS family_code text,            -- short reference e.g. "MEHTA-001"
  ADD COLUMN IF NOT EXISTS family_category text,        -- HNI | Affluent | Retail | NRI | Corporate
  ADD COLUMN IF NOT EXISTS review_frequency text,       -- monthly | quarterly | half_yearly | annual
  ADD COLUMN IF NOT EXISTS first_meeting_date date;     -- anchors the review cadence

-- Quick lookup by code (per tenant). Codes are optional + not enforced-unique
-- (firms may reuse conventions), so a plain index, not a unique constraint.
CREATE INDEX IF NOT EXISTS families_code_idx
  ON families (tenant_id, family_code)
  WHERE family_code IS NOT NULL;
