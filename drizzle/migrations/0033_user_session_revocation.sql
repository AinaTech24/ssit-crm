-- P1 SECURITY: session revocation epoch for stateless JWTs.
--
-- Sessions are 8h JWTs verified with zero I/O at the Edge. The downside: a
-- token stays valid for up to 8 hours after a user is terminated. This column
-- is the revocation epoch — getSession() (src/lib/auth/revocation.ts) rejects
-- any token whose `iat` predates it. Offboarding and forced password resets
-- stamp it to now(), so a departing employee's live token dies on the next
-- request instead of lingering for the rest of the TTL.
--
-- NULL = never revoked (the default for every existing user). Idempotent.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sessions_invalid_after timestamptz;
