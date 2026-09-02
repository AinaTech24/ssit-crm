-- 0056 — Templates: per-version attachments
--
-- Adopted from the Sanchay template form. Lets an email template carry standard
-- files (fund factsheet, KYC form, brochure) that auto-attach on every send.
-- Stored on the version (so they version with the body). Each entry is
-- { name, url }. Additive on an RLS-protected table → no new policy.

ALTER TABLE template_versions
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
