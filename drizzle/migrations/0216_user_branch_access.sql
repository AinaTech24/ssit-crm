-- Per-user BRANCH access grant.
--
-- The firm's data wall is now: you see the records assigned to you, and nothing
-- else — in your branch or any other. Two things lift it:
--
--   1. Role. owner / back_office / ops see every branch and every user's
--      records. That is a property of the role and is not stored here.
--   2. This column. A list of branch ids this specific user may see IN FULL —
--      every record in those branches, whoever owns it. Empty / null means no
--      grant, i.e. the default own-records-only wall.
--
-- It is a per-USER grant rather than a per-role one because "who covers which
-- branch" is a staffing fact that changes without anyone's job title changing:
-- a branch head covering two branches during a vacancy, a senior RM given sight
-- of a neighbouring branch. Encoding that in roles would mean inventing a role
-- per combination.
--
-- Shape: jsonb array of branch uuids as strings, e.g. '["<uuid>", "<uuid>"]'.
-- Stored as jsonb (not uuid[]) to match the existing per-user grants on this
-- table — permissions and enabled_modules are both jsonb string arrays, and the
-- Employee form edits all three the same way.
--
-- NULL rather than '[]' as the default so "never configured" stays
-- distinguishable from "configured, then cleared". Both currently mean the same
-- thing, but only one of them is a decision someone made.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_branches jsonb;

COMMENT ON COLUMN users.allowed_branches IS
  'Branch ids this user may see in full (every record, any owner). Null/empty = own records only. Roles owner/back_office/ops ignore this and see all branches.';
