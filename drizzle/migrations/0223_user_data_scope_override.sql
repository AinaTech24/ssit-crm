-- Per-user data-scope override, replacing the boolean added in 0222.
--
-- 0222 gave one escape hatch: "only their own records". That turned out to be
-- the wrong shape. The real case is a branch head who ALSO holds a firm-wide
-- role — back_office / ops, usually granted so they can do operational work —
-- which resolves the wall to "everything" (ALL_BRANCH_ROLES). The firm then has
-- only two bad options: strip the operational role and break that person's job,
-- or leave them seeing the entire book. "Own records only" doesn't help either:
-- a branch head is supposed to see their branch, not just themselves.
--
-- Symptom that identified it: clients with NO RM assigned were visible to that
-- branch head. A branch scope cannot produce those (no owner ⇒ no branch ⇒ not
-- matched); only a firm-wide scope can.
--
--   NULL     → resolve from roles and grants, as before
--   'branch' → their own branch (+ any explicit branch grants), EVEN IF they
--              hold a role that would otherwise mean the whole firm
--   'own'    → only records assigned to them
--
-- Checked below owner and above everything else, so it is always the deciding
-- answer for anyone it is set on.
--
-- Carries 0222's boolean forward so nobody's visibility changes on deploy.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS data_scope_override text;

UPDATE users
SET data_scope_override = 'own'
WHERE restrict_to_own_records IS TRUE
  AND data_scope_override IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_data_scope_override_chk
  CHECK (data_scope_override IS NULL OR data_scope_override IN ('branch', 'own'))
  NOT VALID;
