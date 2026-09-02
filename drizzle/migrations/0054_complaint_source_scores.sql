-- 0054 — Complaints: SCORES + source tracking, and SEBI-category normalisation
--
-- complaint_source: where the complaint came in from (direct / SCORES / AMFI /
-- AMC / email / phone / walk-in). scores_ref_no: the SEBI SCORES registration
-- number when source = 'scores'. Both additive on an already-RLS-protected
-- table → no new policy needed.
--
-- We also normalise the free-text sebi_category captured by the old form into
-- the standardized slugs the register filters on, so the category filter and
-- the new monthly disclosure actually match historical rows.

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS complaint_source text,
  ADD COLUMN IF NOT EXISTS scores_ref_no text;

UPDATE service_requests SET sebi_category = CASE
  WHEN sebi_category IS NULL THEN NULL
  WHEN sebi_category IN ('service','mis_selling','transaction','fee','kyc','communication','other') THEN sebi_category
  WHEN lower(sebi_category) ~ 'mis.?sell' THEN 'mis_selling'
  WHEN lower(sebi_category) ~ 'service|delay|turnaround|tat' THEN 'service'
  WHEN lower(sebi_category) ~ 'transaction|order|nav|unit|redemption|switch' THEN 'transaction'
  WHEN lower(sebi_category) ~ 'fee|commission|charge|brokerage|load' THEN 'fee'
  WHEN lower(sebi_category) ~ 'kyc|document|pan|aadhaar' THEN 'kyc'
  WHEN lower(sebi_category) ~ 'communicat|statement|report|email|sms' THEN 'communication'
  ELSE 'other'
END
WHERE type = 'complaint';

-- Existing complaints default to 'direct' so the source column/filter is populated.
UPDATE service_requests SET complaint_source = 'direct'
WHERE type = 'complaint' AND complaint_source IS NULL;
