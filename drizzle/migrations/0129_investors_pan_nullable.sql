-- 0129 — make investors.pan nullable.
--
-- PAN is often captured AFTER KYC documents are received, so a lead can be
-- converted to a client before the PAN is known. The unique index
-- (tenant_id, pan) still applies, and Postgres treats NULLs as DISTINCT, so
-- multiple PAN-pending clients per tenant are allowed. Existing rows are
-- unaffected (they already have a PAN).

ALTER TABLE investors ALTER COLUMN pan DROP NOT NULL;
