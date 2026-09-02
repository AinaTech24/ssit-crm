-- Razorpay recurring billing bookkeeping on subscriptions.
--
--   razorpay_plan_id      — the dynamically-created Plan the subscription rides
--   mandate_status        — none | pending | active | failed (e-mandate state)
--   failed_payment_count  — consecutive auto-debit failures, for retry-then-
--                           suspend dunning (reset to 0 on a successful charge)
--   razorpay_customer_id / razorpay_subscription_id already exist.
--
-- Additive + idempotent.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_plan_id     text,
  ADD COLUMN IF NOT EXISTS mandate_status       text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS failed_payment_count integer NOT NULL DEFAULT 0;
