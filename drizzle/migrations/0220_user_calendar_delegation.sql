-- Per-user calendar delegation: the colleagues whose meetings this user handles.
--
-- The firm needs a front-desk/EA who runs ONE partner's diary — books, moves
-- and cancels that person's meetings — without being handed anything else.
-- Before this the only ways to let someone touch another person's meetings
-- were review_meeting.manage.all (the WHOLE firm's meetings) or an
-- allowed_branches grant (every record in a branch, whoever owns it). Both are
-- far wider than "runs Hitesh's calendar", and both collide with the rule that
-- a person sees only their own records.
--
-- NULL / empty = no delegation (the default, and what every existing row gets).
-- A list of user ids = this user additionally sees and may create/edit/cancel
-- meetings owned by those people. Read from the DB per request, never from the
-- session token, so revoking a delegation bites on the next request rather
-- than whenever the user happens to log in again — same rule as
-- allowed_branches (migration 0216).
--
-- jsonb (not uuid[]) to match allowed_branches / enabled_modules / permissions,
-- which are all jsonb string arrays; the loader re-validates each value as a
-- uuid before it ever reaches a ::uuid cast.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS delegates_for jsonb;
