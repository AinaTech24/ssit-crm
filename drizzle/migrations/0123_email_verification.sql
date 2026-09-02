-- 0123 — email verification for self-serve signup.
--
-- Self-serve signup previously logged the owner in immediately on an
-- UNVERIFIED email + unvalidated ARN, so the firm's primary contact (used for
-- billing, password reset, invites) could be a typo or a throwaway address.
-- We now stamp users.email_verified_at and issue a one-time verification token
-- (mirrors password_resets: SHA-256 hash only, TTL, consumed-once).

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Grandfather every user that already exists: they predate verification and
-- must not be locked out of verification-gated actions. Only NEW self-serve
-- signups (from this point) start unverified.
UPDATE users SET email_verified_at = COALESCE(activated_at, created_at, now())
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  email        text NOT NULL,
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  request_ip   text,
  request_user_agent text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verifications_token_idx ON email_verifications (token_hash);
CREATE INDEX IF NOT EXISTS email_verifications_email_idx ON email_verifications (email);

-- RLS: parity with every other tenant_id table (accessed system-side during
-- signup/verify via withSystem, which legitimately bypasses RLS).
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_verifications;
CREATE POLICY tenant_isolation ON email_verifications FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
