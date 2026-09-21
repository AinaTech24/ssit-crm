-- Give task.assign.others to everyone whose custom permission list predates it.
--
-- A non-empty users.permissions is a strict ALLOW-LIST: can() returns
-- permissions.includes(cap) and never consults the role matrix. That is the
-- point — unticking a box has to actually take the capability away.
--
-- The consequence nobody had hit yet: a capability added LATER cannot possibly
-- appear in a list that was saved earlier, so every customised user is denied
-- it forever, silently, whatever their role says. task.assign.others is the
-- first such capability, and it landed as a split out of task.edit.all — so
-- customised RMs and Back Office staff lost the Assign to picker entirely and
-- got "you can only assign tasks to yourself" with an empty dropdown, while
-- uncustomised users on the same roles were fine.
--
-- Anyone whose list lets them work tasks at all (task.edit.assigned) or edit
-- anyone's (task.edit.all) gets the new capability, which is exactly what the
-- role matrix now grants them. A list without either is someone who was never
-- meant to touch tasks; they stay as they are.
--
-- Idempotent: the @> guard means re-running changes nothing, and an owner who
-- deliberately unticks this later will NOT have it handed back, because this
-- runs once per database rather than on every boot.
--
-- NOTE FOR THE NEXT CAPABILITY: adding one to the Capability union is not
-- enough. Ship a backfill like this one in the same change, or every customised
-- user silently loses it.
UPDATE users
SET permissions = permissions || '["task.assign.others"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["task.assign.others"]'::jsonb
  AND (
    permissions @> '["task.edit.assigned"]'::jsonb
    OR permissions @> '["task.edit.all"]'::jsonb
  );
