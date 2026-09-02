-- 0127 — extended client-master fields (Batch 2).
--
-- Adds the additional investor profile fields requested for the client form:
-- personal (marital status, mode of holding, anniversary, tax status, birth
-- place, mother's name, contact relations), classification (referral, family
-- owner/type), and full second-holder (joint) details. All nullable text/date,
-- so this is purely additive and safe. RLS is already enforced on `investors`,
-- so new columns are covered by the existing tenant_isolation policy.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS marital_status text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS mode_of_holding text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS anniversary_date date;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS tax_status text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS birth_place text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS mother_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS mobile_relation text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS email_relation text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS referral_client_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS family_owner_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS household_type text;  -- "Family or Individual"

-- Second / joint holder details.
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_first_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_last_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_occupation text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_company_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_birth_place text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_mother_name text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS second_holder_marital_status text;
