-- Per-user (per-seat) pricing on packages.
--
-- The platform now charges a one-time setup cost (already `setup_cost_paise`)
-- PLUS a recurring per-user fee — an MFD that wants to add a staff seat pays
-- this much extra. Two columns so monthly and yearly billing cycles can carry
-- different per-seat rates (e.g. ₹2,500/user/month vs ₹15,000/user/year).
--
-- Stored in paise (₹1 = 100 paise) to match the existing price columns.
-- Additive + idempotent — defaults to 0 so existing packages are unaffected.

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS per_user_monthly_paise integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_user_yearly_paise  integer NOT NULL DEFAULT 0;
