-- Correct investors.branch_id for rows where it does NOT match the assigned
-- RM's own branch — not just the NULL case migration 0218 already backfilled.
--
-- Root cause (now fixed in code, see src/app/api/investors/route.ts POST and
-- src/app/api/investors/[id]/route.ts PATCH): both the single-client CREATE
-- route and the RM-reassignment path set/left branch_id at whatever the
-- ACTING USER's own branch happened to be (or untouched on reassignment),
-- never the branch of the RM the client was actually assigned to. A
-- back_office/ops user (no branch of their own) creating or reassigning
-- clients across the firm is the common case, not the exception — so in
-- practice nearly every client ended up tagged with one arbitrary branch
-- (usually HQ, wherever the firm's admin work happens to be done from)
-- regardless of which branch actually serves them.
--
-- BranchCockpit.tsx carries a comment describing investors.branch_id as
-- "independently reassignable — a client can follow its book to a new
-- branch without its RM transferring". Searched the whole API surface for
-- any feature that actually DOES that (a dedicated "move client to another
-- branch" action, independent of changing its RM) — there isn't one. Every
-- write path that touches branch_id either derives it from the RM (now,
-- after this session's fixes) or never set it at all. So that comment
-- describes an aspiration the product never actually implemented; every
-- mismatch in real data is this bug, not a deliberate reassignment, and is
-- safe to correct in bulk.
--
-- Effect: a branch head who could see the WHOLE FIRM (every client
-- coincidentally tagged with their own branch) now sees only their actual
-- branch's clients; a branch head who could see NONE of their branch's
-- clients (tagged with someone else's branch) now sees them. Matches the
-- rmId owner, falling back to service_rm_id when rm_id has no branch.
--
-- Idempotent: only touches rows whose branch_id doesn't already match, so
-- re-running is a no-op the second time.

UPDATE investors i
SET branch_id = u.branch_id
FROM users u
WHERE u.tenant_id = i.tenant_id
  AND u.id = COALESCE(i.rm_id, i.service_rm_id)
  AND u.branch_id IS NOT NULL
  AND i.branch_id IS DISTINCT FROM u.branch_id;
