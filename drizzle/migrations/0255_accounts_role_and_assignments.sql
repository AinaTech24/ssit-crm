-- New role: "accounts" (label "Accounts") — the firm's bookkeeper. roles is a
-- plain text[] with no CHECK constraint (see 0215), so the role itself needs no
-- schema change; this migration only makes the two assignments that were asked for.
--
--   mehul@equitywala.com  -> Accounts
--   hitesh@equitywala.com -> Owner / Admin (the firm's boss: sees every record)
--
-- Added to the person's existing roles, never replacing them, and idempotent: a
-- re-run changes nothing. An email that matches nobody is simply skipped. Both are
-- undone from Employees -> Edit -> Roles. They must log out and back in once.

UPDATE users
SET roles = array_append(roles, 'accounts')
WHERE lower(email) = 'mehul@equitywala.com'
  AND NOT ('accounts' = ANY (roles));

UPDATE users
SET roles = array_append(roles, 'owner')
WHERE lower(email) = 'hitesh@equitywala.com'
  AND NOT ('owner' = ANY (roles));
