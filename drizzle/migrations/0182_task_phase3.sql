-- Task module Phase 3 — watchers, dependencies (blocked-by), and the
-- approval-escalation watermark. All additive.

-- ── Dependencies + approval escalation on tasks ───────────────────────────
--   blocked_by_task_id   : this task is blocked until that task is done.
--   approval_escalated_at: set once the "stale pending approval" nudge fired,
--                          so it isn't re-sent every scan tick.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_by_task_id uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_escalated_at timestamptz;

-- ── Watchers (followers) ──────────────────────────────────────────────────
-- A user who wants a task's notifications without being its assignee.
CREATE TABLE IF NOT EXISTS task_watchers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_watchers_unique
  ON task_watchers (tenant_id, task_id, user_id);
CREATE INDEX IF NOT EXISTS task_watchers_user_idx
  ON task_watchers (tenant_id, user_id);

ALTER TABLE task_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_watchers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_watchers;
CREATE POLICY tenant_isolation ON task_watchers FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
