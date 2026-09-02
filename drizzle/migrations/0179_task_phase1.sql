-- Task module Phase 1 — approval/verification loop, per-task reminders,
-- overdue-alert dedup watermark, and real threaded comments (@mentions).
--
-- All additive. Existing tasks are unaffected (requires_approval defaults false,
-- every new nullable column starts NULL).

-- ── Approval / verification loop (10x-Task-style delegation) ───────────────
--   requires_approval  : the task must be signed off by its approver when done.
--   approval_status    : NULL (n/a) | 'pending' (submitted) | 'approved' | 'rejected'.
--   submitted_at       : when the assignee sent it for approval.
--   approved_by/_at    : who signed off (approve OR reject) and when.
--   approval_note      : reviewer's note (esp. the reason on a reject/reopen).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_status text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_note text;

-- ── Per-task reminders (lead-time alerts) ─────────────────────────────────
--   remind_at          : absolute time to ping the assignee (UI computes it
--                        from the due date + a lead-time, or an explicit time).
--   reminder_fired_at  : NULL until the scanner fires it; cleared when remind_at
--                        changes so an edited reminder re-arms.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_fired_at timestamptz;

-- ── Overdue-alert dedup watermark ─────────────────────────────────────────
--   overdue_notified_at: set when the reminder scanner has already fired the
--                        one-time 'task.overdue' event + in-app alert, so a
--                        still-open overdue task isn't re-notified every tick.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_notified_at timestamptz;

-- Scan indexes. remind_at partial index keeps the reminder sweep cheap
-- (only un-fired reminders are ever scanned).
CREATE INDEX IF NOT EXISTS tasks_remind_idx
  ON tasks (tenant_id, remind_at) WHERE reminder_fired_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_approval_idx
  ON tasks (tenant_id, approval_status);

-- ── Threaded task comments (real author + @mentions, replaces the old
--    single prepend-only `remarks` blob as the interactive log) ────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   uuid,                          -- FK users(id); NULL if author later removed
  body        text NOT NULL,
  -- Array of mentioned user ids (uuid[]); each gets a 'task.mention' notification.
  mentions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at  timestamptz,                   -- soft delete
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx
  ON task_comments (tenant_id, task_id, created_at);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_comments;
CREATE POLICY tenant_isolation ON task_comments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
