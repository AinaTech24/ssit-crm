-- Subscription category for RA (research / advisory) sales.
--
-- An RA sales lead is not a mutual-fund prospect: it is somebody being sold a
-- research subscription. So a lead carries a CATEGORY —
--   non_subscribed  the default; still being worked
--   signed_up       has signed up but not yet paying
--   subscribed      paying; converts to a client automatically
-- — and a subscribed one carries a FREQUENCY (quarterly / half_yearly / yearly)
-- from which the renewal date is calculated. The same four columns live on the
-- client so the renewal follows the person across conversion.
--
-- arn_no is the ARN shown on an RA client (their own ARN, not the firm's).
--
-- Text + app-side validation, like the other category columns here.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS subscription_category text,
  ADD COLUMN IF NOT EXISTS subscription_frequency text,
  ADD COLUMN IF NOT EXISTS subscription_started_at date,
  ADD COLUMN IF NOT EXISTS subscription_renewal_at date;

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS subscription_category text,
  ADD COLUMN IF NOT EXISTS subscription_frequency text,
  ADD COLUMN IF NOT EXISTS subscription_started_at date,
  ADD COLUMN IF NOT EXISTS subscription_renewal_at date,
  ADD COLUMN IF NOT EXISTS arn_no text;
