-- Marketing tasks are approved by the person who ASSIGNED them.
--
-- Until now a marketing task's approver was the firm's content approver (set when
-- the task was created, or filled in on submit). New tasks now name the assigner as
-- approver; this re-points the ones still in flight so they behave the same way —
-- e.g. a task Palak assigned to Dhvani now waits for Palak, not for someone else.
--
-- Only tasks that are not yet approved and not finished are touched, so approvals
-- already given keep their record. A task a marketing person assigned to
-- themselves points at themselves, as the new rule says. Idempotent: the final
-- condition skips tasks that already name their creator.

-- Tell each assigner about the approvals that are now waiting on them.
INSERT INTO notifications (id, tenant_id, user_id, kind, title, body, link_url, severity, meta)
SELECT gen_random_uuid(), t.tenant_id, t.created_by_id, 'task.approval_requested',
       'Approval needed: ' || t.title,
       'Submitted by ' || COALESCE(a.name, 'the marketing team') || ' for your approval',
       '/dashboard/tasks?approval=mine', 'info', jsonb_build_object('task_id', t.id)
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assignee_id
 WHERE t.department = 'marketing'
   AND t.created_by_id IS NOT NULL
   AND t.created_by_id IS DISTINCT FROM t.assignee_id
   AND t.approval_status = 'pending'
   AND t.status NOT IN ('completed', 'cancelled')
   AND t.deleted_at IS NULL
   AND COALESCE(t.meta ->> 'approverId', '') <> t.created_by_id::text;

UPDATE tasks
   SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{approverId}', to_jsonb(created_by_id::text), true)
 WHERE department = 'marketing'
   AND created_by_id IS NOT NULL
   AND (approval_status IS NULL OR approval_status IN ('pending', 'rejected'))
   AND status NOT IN ('completed', 'cancelled')
   AND deleted_at IS NULL
   AND COALESCE(meta ->> 'approverId', '') <> created_by_id::text;
