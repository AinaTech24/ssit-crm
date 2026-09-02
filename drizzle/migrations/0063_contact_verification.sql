-- 0063 — Contact verification tracking (Sanchay "Verified At" parity).
--
-- Stamp when a client's email / phone was confirmed correct, so RMs can see
-- which contact details are unverified (deliverability + KYC hygiene) and work
-- a "verification due" list.
--
-- Columns added to an existing table → investors already carries
-- tenant_isolation; no RLS change needed.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS contact_verified_by uuid;
