-- FEATURE: TOTP two-factor auth recovery codes.
--
-- When a user enables 2FA we issue a set of one-time backup codes so a lost
-- authenticator device doesn't lock them out of their account. Stored as bcrypt
-- hashes (never plaintext); each is consumed on use during login verification.
--
-- two_fa_enabled / two_fa_secret already exist on users. Idempotent.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_fa_backup_codes jsonb;
