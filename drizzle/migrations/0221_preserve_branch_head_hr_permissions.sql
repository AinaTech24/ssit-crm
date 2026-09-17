-- Preserve leave/attendance administration for branch heads who already have a
-- CUSTOMISED permission list.
--
-- Leave and attendance management used to be hardcoded as
-- `roles.some(r => ["owner","branch_head"].includes(r))` inside their routes,
-- which bypassed users.permissions entirely: a branch head administered leave
-- whether or not their custom permission list said so. They are capabilities
-- now (leave.manage.all / attendance.manage.all) so the work can be handed to
-- the person who actually does it without also making them a branch head.
--
-- The catch: can() treats a NON-EMPTY users.permissions as an allow-list —
-- ticking grants, unticking takes away. So a branch head who had "Customize
-- Access Permissions" switched on before this change has a list that predates
-- these two capabilities and would silently LOSE leave/attendance admin on
-- deploy. This backfills exactly what they already had, nothing more.
--
-- Owners need no backfill: can() short-circuits to true for them.
-- Users on role defaults (permissions NULL or []) need none either — they pick
-- the capabilities up from the role matrix.
--
-- Idempotent: jsonb `-` then `||` re-adds without duplicating, and the WHERE
-- clause stops matching once both keys are present.

UPDATE users
SET permissions = (
      (permissions - 'leave.manage.all' - 'attendance.manage.all')
      || '["leave.manage.all","attendance.manage.all"]'::jsonb
    )
WHERE roles @> ARRAY['branch_head']::text[]
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT (permissions @> '["leave.manage.all","attendance.manage.all"]'::jsonb);
