-- Keep customised branch heads and assistants working after the leave split.
--
-- Same trap as 0225 and 0226: a non-empty users.permissions is a strict
-- ALLOW-LIST, so a capability added later can never appear in a list saved
-- earlier and reads as "unticked" forever, whatever the role matrix says.
--
-- Two moves here, matching the new matrix:
--
--   * branch_head gains leave.manage.branch (their own sub-branch). They used
--     to hold leave.manage.all, which gave them every employee's leave and
--     stated reason across every branch. A customised head keeps whatever was
--     explicitly ticked — if an admin deliberately granted them firm-wide
--     leave, that stays granted; this only adds the scoped one so the branch
--     they actually run does not go dark.
--
--   * assistant gains leave.manage.all, because a branch head cannot approve
--     their own request and it has to land with someone above the branch:
--     admin, assistant or gifting/HR.
--
-- Idempotent: the @> guards make a re-run a no-op, and it runs once per
-- database, so an owner who later unticks either does not have it handed back.
UPDATE users
SET permissions = permissions || '["leave.manage.branch"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["leave.manage.branch"]'::jsonb
  AND roles && ARRAY['branch_head']::text[];

UPDATE users
SET permissions = permissions || '["leave.manage.all"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["leave.manage.all"]'::jsonb
  AND roles && ARRAY['assistant']::text[];
