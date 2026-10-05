-- A billing contact per AMC empanelment, alongside the RM / Ops / Escalation
-- contacts: the person at the AMC who handles brokerage invoices and payouts.
ALTER TABLE amc_empanelments
  ADD COLUMN IF NOT EXISTS billing_name text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_phone text;
