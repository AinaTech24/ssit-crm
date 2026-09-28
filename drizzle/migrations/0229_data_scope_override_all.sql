-- Allow data_scope_override = 'all': every client in the firm, by grant.
--
-- 0223 gave two answers and both NARROW: 'branch' (their branch only) and
-- 'own' (their own records). There was no way to widen someone — the only
-- routes to the whole firm were holding owner, back_office or ops, or ticking
-- every branch one at a time and remembering to tick the next new one.
--
-- The case that needed it: an insurance user who services the whole book. They
-- hold investor.view.assigned, so the wall gives them their own records —
-- which, with nothing assigned to them, is an empty Clients list. Granting
-- back_office to fix a visibility problem would hand over edit rights across
-- the firm, which is not what anyone means by "let them see the clients".
--
--   NULL     → resolve from roles and grants, as before
--   'all'    → every record in the firm, whoever owns it
--   'branch' → their own branch (+ any explicit branch grants)
--   'own'    → only records assigned to them
--
-- Still only a VISIBILITY answer. Capabilities are unchanged: someone granted
-- 'all' sees what their view capability already allowed, across more rows. It
-- does not grant edit, export or anything else.
--
-- The constraint is replaced rather than edited (Postgres has no ALTER for a
-- CHECK body). NOT VALID again for the same reason 0223 used it: existing rows
-- already satisfy it, so there is no point scanning the table on deploy.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_data_scope_override_chk;

ALTER TABLE users
  ADD CONSTRAINT users_data_scope_override_chk
  CHECK (data_scope_override IS NULL OR data_scope_override IN ('all', 'branch', 'own'))
  NOT VALID;

COMMENT ON COLUMN users.data_scope_override IS
  'Explicit per-user record visibility, beating roles and grants: all | branch | own. NULL resolves from roles.';
