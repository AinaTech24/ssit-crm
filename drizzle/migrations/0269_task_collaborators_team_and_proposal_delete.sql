-- 1. Task collaborators: colleagues who work a task together with its assignee (like a meeting's collaborators).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS collaborator_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. "Shares tasks with": people whose tasks show up in each other's All tasks view (a back-office pair, say).
--    Set on either person's employee record; it works both ways. Assigned-to-me / Assigned-by-me stay personal.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS task_team_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Deleting a proposal only marked it "rejected", so it stayed in the list. Deleted ones now carry deleted_at.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE proposals
   SET deleted_at = COALESCE(rejected_at, updated_at, now())
 WHERE deleted_at IS NULL AND status = 'rejected' AND rejection_reason = 'deleted';
