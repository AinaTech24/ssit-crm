-- Targets vs Achievement: per-RM MONTHLY meeting targets (counts).
--
-- The ₹ business target already lives on users.annual_target (annual sales /AUM)
-- and users.sip_monthly_target (monthly SIP mobilisation). This adds the two
-- meeting-count targets the Targets settings page + dashboard quota use:
--   - new_meetings_monthly_target      → review_meetings.category = 'new'
--   - renewal_meetings_monthly_target  → review_meetings.category = 'review'
--
-- Nullable: a member with no target set simply shows "no target" (the dashboard
-- already treats 0/null as "Set your target").

ALTER TABLE users ADD COLUMN IF NOT EXISTS new_meetings_monthly_target integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS renewal_meetings_monthly_target integer;
