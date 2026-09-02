-- Task module Phase 2 — time tracking (estimate + logged) and file attachments.
-- All additive.

-- ── Time tracking ─────────────────────────────────────────────────────────
--   estimate_minutes    : planned effort (optional).
--   time_spent_minutes  : accumulated logged effort (sum of task_time_logs).
--   (tasks.started_at, which already exists, is reused as the running-timer mark:
--    non-null = a timer is running since that instant.)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_minutes integer;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_spent_minutes integer NOT NULL DEFAULT 0;

-- Individual time entries (a manual log, or a timer start→stop span).
CREATE TABLE IF NOT EXISTS task_time_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     uuid,                          -- who logged it
  minutes     integer NOT NULL,
  note        text,
  logged_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_time_logs_task_idx
  ON task_time_logs (tenant_id, task_id, logged_at DESC);

ALTER TABLE task_time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_time_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_time_logs;
CREATE POLICY tenant_isolation ON task_time_logs FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- ── File attachments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by   uuid,
  file_name     text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  storage_key   text NOT NULL,               -- S3 object key (tenant-scoped)
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_attachments_task_idx
  ON task_attachments (tenant_id, task_id, created_at DESC);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_attachments;
CREATE POLICY tenant_isolation ON task_attachments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
