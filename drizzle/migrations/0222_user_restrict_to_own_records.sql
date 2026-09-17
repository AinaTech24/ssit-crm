-- Per-user "only their own records" override.
--
-- The data wall widens on ROLE in one place: branch_head always includes that
-- person's own branch, no grant required (see OWN_BRANCH_ROLES in
-- src/lib/auth/data-scope.ts — "running that branch is the job, so it does not
-- wait on someone remembering to tick a box").
--
-- That is right for a pure branch head and wrong for the common real case: an
-- RM who carries their own book AND holds branch_head for something
-- administrative (approving leave, covering the office). They silently saw
-- every client in the branch instead of their own — and nothing on screen said
-- why, because the role badge shows the FIRST matching role and "Relationship
-- Manager" sorts ahead of "Branch Head". A firm hitting this had no fix short
-- of stripping the role and losing the approvals with it.
--
-- This column is the explicit answer: tick it and the person sees only records
-- assigned to them, whatever roles or branch grants they hold. It is checked
-- ABOVE both the role widening and the grant, and below owner only.
--
-- Defaults false, so nobody's visibility changes on deploy.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS restrict_to_own_records boolean NOT NULL DEFAULT false;
