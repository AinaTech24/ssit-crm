ALTER TABLE "risk_profile_responses" ADD COLUMN "verification_method" text DEFAULT 'rm_entry' NOT NULL;
ALTER TABLE "risk_profile_responses" ADD COLUMN "otp_transaction_id" text;
ALTER TABLE "risk_profile_responses" ADD COLUMN "client_ip" text;
ALTER TABLE "risk_profile_responses" ADD COLUMN "client_user_agent" text;
