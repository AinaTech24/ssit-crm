-- Target an announcement at a SUB-BRANCH, not just a branch.
--
-- Announcements could be firm-wide or branch-wide. Most firms have one
-- registered branch, so "Target Branch" offered a single choice that changed
-- nothing — while the teams a notice is actually for ("Anand desk, we're
-- moving the Friday review") are desks.
--
--   branch_id NULL + desk_id NULL  → the whole firm, as before
--   desk_id set                    → only people on that desk
--   branch_id set                  → only people in that branch
--
-- Nullable and unset on every existing row, so nothing already posted changes
-- audience on deploy.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS desk_id uuid;

COMMENT ON COLUMN announcements.desk_id IS
  'Sub-branch (desk) this notice is for. NULL = not desk-scoped. Narrows alongside branch_id and audience_roles.';
