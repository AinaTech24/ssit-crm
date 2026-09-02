-- 0130 — client-collected KYC data capture.
--
-- The public document link (/d/<token>) now also collects KYC DATA fields
-- (CKYC/KRA common-application-form parity), not just document uploads. The
-- mapped fields flow straight into the client master; this jsonb column stores
-- the full raw submission so unmapped fields (guardian, overseas address, TIN,
-- entity registration, PEP/source-of-wealth, …) are never lost and can be
-- surfaced/audited later.
--
-- `leads.kyc_data` holds the submission while the subject is still a lead; the
-- lead→client convert flow copies it onto the new investor. Both tables already
-- enforce RLS, so the new columns are covered by the existing tenant_isolation
-- policy. Purely additive + nullable — safe.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS kyc_data jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS kyc_data jsonb;
