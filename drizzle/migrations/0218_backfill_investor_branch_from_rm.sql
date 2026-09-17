-- Backfill investors.branch_id from the assigned RM's own branch, for rows
-- where it was never set.
--
-- The bulk Excel importer (src/app/api/investors/import/commit/route.ts) set
-- branch_id to the IMPORTER's own branch (session.branchId), not the branch
-- of the RM the row was actually assigned to. For an owner/back-office import
-- — the common case, since bulk imports are usually done centrally, not by
-- each RM individually — session.branchId is unset, so every imported client
-- landed with branch_id NULL regardless of which branch its RM belonged to.
--
-- BranchCockpit and the data wall (src/lib/auth/data-scope.ts /
-- src/lib/investors/access.ts) both filter a branch head's "book" view on
-- investors.branch_id, so a NULL here made the client invisible to the
-- branch head running the RM's own branch, even though the RM themself could
-- see it fine (the RM's "own records" scope matches on rm_id, not branch_id).
--
-- This only fills NULL branch_id — it never overwrites a value that's
-- already set, since BranchCockpit's own docs treat investors.branch_id as
-- independently reassignable (a client can follow its book to a new branch
-- without an RM transfer), and a blanket overwrite would undo a deliberate
-- reassignment. Idempotent: safe to re-run, matches only rows still NULL.
--
-- Falls back to service_rm_id's branch when rm_id has none (or is unset) —
-- either RM "owns" the client per lib/investors/access.ts.

UPDATE investors i
SET branch_id = u.branch_id
FROM users u
WHERE i.branch_id IS NULL
  AND u.branch_id IS NOT NULL
  AND u.tenant_id = i.tenant_id
  AND u.id = COALESCE(i.rm_id, i.service_rm_id);
