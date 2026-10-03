-- "Switch to admin view" for a person who normally works inside one sub-branch.
--
-- A sub-branch head is walled to their own desk, which is right for the day to
-- day. Some of them also have to act as the firm admin now and then — see every
-- sub-branch, open every module. Making them an owner permanently would remove
-- the wall; this flag instead lets them OPT IN, per session, from the profile
-- menu, and drop back to their sub-branch view the same way.
--
-- The flag only makes the switch AVAILABLE. Nothing is elevated until the user
-- flips it (a cookie, read in getSession), and the flag is read from this
-- column on every elevated request, so unticking it ends the access on the next
-- page load rather than at the next login.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_switch_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.can_switch_admin IS
  'May switch their session to the firm-admin view from the profile menu. Opt-in per session; default view stays their own wall.';
