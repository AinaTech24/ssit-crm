-- Task templates — owner-designed predefined tasks with sub-task checklists.
-- The admin/owner designs a template ("New client onboarding" → collect docs →
-- KYC → UCC → mandate…) with default type/department/priority/due-offset; the
-- new-task form applies it, and the sub-tasks land in the existing
-- tasks.meta.checklist (rendered + toggled by TaskDetailDrawer — no tasks
-- schema change needed). Additive + idempotent, tenant-scoped with RLS.

CREATE TABLE IF NOT EXISTS task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  -- Defaults applied to the main task (all optional; the form can override).
  task_type text,
  department text,
  priority text,
  due_offset_days integer,
  -- Predefined sub-tasks: [{ id, text }] — `done` is added per-task at apply time.
  subtasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_templates_tenant_idx ON task_templates (tenant_id, is_active, name);

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_templates;
CREATE POLICY tenant_isolation ON task_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
