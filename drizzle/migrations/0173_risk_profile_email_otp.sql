-- Email-OTP confirmation for client-submitted risk profiles.
-- The public /r/<token> form emails the client a 6-digit code; the submit
-- route verifies it and stamps the response with the verified email + time —
-- audit-grade proof the client themselves signed off.
--   · public_email_otps — one active code per share token (hashed, expiring,
--     attempt-limited). Tenant-scoped with RLS (public routes resolve the
--     tenant from the share token, then act inside withTenant).
--   · risk_profile_templates.require_email_otp — per-firm toggle (Settings →
--     Risk profile). Defaults ON.
--   · risk_profile_responses.verified_email / email_verified_at — the proof.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS public_email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  token_id uuid NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_email_otps_token_uq ON public_email_otps (token_id);

ALTER TABLE public_email_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_email_otps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public_email_otps;
CREATE POLICY tenant_isolation ON public_email_otps
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE risk_profile_templates ADD COLUMN IF NOT EXISTS require_email_otp boolean NOT NULL DEFAULT true;

ALTER TABLE risk_profile_responses ADD COLUMN IF NOT EXISTS verified_email text;
ALTER TABLE risk_profile_responses ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
