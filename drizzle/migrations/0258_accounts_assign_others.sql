-- The Accounts role (migration 0255) can create tasks but was left out of
-- task.assign.others, so it could only ever assign a task to itself.
--
-- A non-empty users.permissions is a strict ALLOW-LIST (see 0225), so anyone with
-- the Accounts role AND a saved custom list needs the capability appended; people
-- without a saved list get it from the role matrix. Only lists that already let the
-- person work tasks (task.edit.assigned / task.edit.all) are touched, as in 0225.
-- Idempotent (@> guard).
UPDATE users
SET permissions = permissions || '["task.assign.others"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND 'accounts' = ANY(roles)
  AND NOT permissions @> '["task.assign.others"]'::jsonb
  AND (
    permissions @> '["task.edit.assigned"]'::jsonb
    OR permissions @> '["task.edit.all"]'::jsonb
  );
