-- 0131 — store the registered mandate amount on the client.
--
-- When the team marks a SIP mandate "Activated" they capture which bank it's on
-- (mirrored into the existing bank_* columns), the max debit amount, and the
-- approval reference (mandate_ref_no). Only the amount lacked a home — add it.
-- Nullable numeric, additive, RLS already enforced on investors.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS mandate_amount numeric(18,2);
