-- Grandfather invited team members as email-verified.
--
-- Accepting an emailed invite proves email ownership. But members who accepted
-- BEFORE the accept-invite flow started stamping email_verified_at (and after
-- the one-time 0123 backfill) are stuck: their email_verified_at is NULL, so the
-- "confirm your own email before inviting team members" gate blocks them with no
-- self-serve way out.
--
-- This stamps email_verified_at for ACTIVE users who joined via an accepted
-- invite (they demonstrably control the address). Self-signed-up owners who
-- never verified are intentionally left alone — the verification gate still
-- applies to them. A "Send verification email" button on the profile now covers
-- any remaining unverified user going forward.

UPDATE users u
SET email_verified_at = COALESCE(u.email_verified_at, u.activated_at, u.created_at),
    updated_at = now()
WHERE u.status = 'active'
  AND u.email_verified_at IS NULL
  AND EXISTS (SELECT 1 FROM user_invites i WHERE i.accepted_user_id = u.id);
