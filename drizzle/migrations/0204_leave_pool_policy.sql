-- Leave: a single accruing pool instead of independent per-type quotas.
--
-- Firm policy is "18 days a year, earned 1.5 a month". The old model gave every
-- leave TYPE its own annual quota (casual 12 + sick 6 + earned 15 = 33 days) and
-- handed the whole year's quota out on day one, so someone who joined in
-- February could book a fortnight in week two.
--
-- Both numbers live per tenant rather than as constants, because this is firm
-- policy and firms change it. The defaults are the policy as stated.
--
-- Per-type entitlements are NOT dropped: comp-off, unpaid and "other" still sit
-- outside the pool, and keeping the column means a firm that had customised its
-- quotas does not silently lose them if the pool is ever turned off.

ALTER TABLE leave_settings
  ADD COLUMN IF NOT EXISTS annual_total numeric(5,1) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS monthly_accrual numeric(4,2) NOT NULL DEFAULT 1.5;

COMMENT ON COLUMN leave_settings.annual_total IS
  'Paid-leave days per financial year, shared across casual/sick/earned. Ceiling on accrual.';
COMMENT ON COLUMN leave_settings.monthly_accrual IS
  'Days earned per completed month of the financial year, capped at annual_total.';
