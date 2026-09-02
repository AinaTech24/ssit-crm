-- 0144 — Claim document checklist. Uploaded supporting files per claim
-- (hospital bills, discharge summary, death certificate, KYC, bank proof…).

ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;
