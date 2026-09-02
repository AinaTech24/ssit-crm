-- Multiple nominees + multiple bank accounts per investor.
-- The legacy single columns (nominee_name/…, bank_name/…) are kept and now
-- mirror the first array entry, so existing readers (PDFs, proposals) still work.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS nominees jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS bank_accounts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill the arrays from any existing single nominee / bank on file.
UPDATE investors
SET nominees = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object('name', nominee_name, 'relation', nominee_relation, 'dob', nominee_dob))
)
WHERE COALESCE(nominee_name, '') <> '' AND (nominees IS NULL OR nominees = '[]'::jsonb);

UPDATE investors
SET bank_accounts = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object('bankName', bank_name, 'accountMasked', bank_account_masked, 'ifsc', bank_ifsc))
)
WHERE COALESCE(bank_name, '') <> '' AND (bank_accounts IS NULL OR bank_accounts = '[]'::jsonb);
