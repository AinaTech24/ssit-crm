-- 0052 — Leads: pipeline value + qualification fields
--
-- The lead create form now captures real pipeline value + qualification
-- context (mirroring the Sanchay leads form, adapted to our model). The list's
-- "Pipeline value" KPI was summing a regexp-cleaned free-text column
-- (intended_amount); expected_business_amount gives it a clean numeric source.
-- The other columns power segmentation + scoring.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS expected_business_amount numeric(16, 2),
  ADD COLUMN IF NOT EXISTS aum_potential text,
  ADD COLUMN IF NOT EXISTS lead_type text,
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS alt_phone text,
  ADD COLUMN IF NOT EXISTS alt_email text;

-- Backfill the canonical numeric from the old free-text field, but ONLY when
-- the stripped value is cleanly numeric (avoids a cast error aborting the run).
UPDATE leads
SET expected_business_amount =
      regexp_replace(intended_amount, '[^0-9.]', '', 'g')::numeric
WHERE expected_business_amount IS NULL
  AND intended_amount IS NOT NULL
  AND regexp_replace(intended_amount, '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$';

CREATE INDEX IF NOT EXISTS leads_type_idx ON leads (tenant_id, lead_type);
