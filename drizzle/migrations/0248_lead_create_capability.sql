-- "Add leads" becomes its own permission (lead.create), separate from editing.
--
-- Creating a lead used to ride on lead.edit.all / lead.edit.assigned, so the
-- owner could not let someone work leads without letting them add new ones, or
-- the other way round. The role defaults grant lead.create to exactly the roles
-- that could create before, so nothing changes for uncustomised users.
--
-- A non-empty users.permissions is a strict ALLOW-LIST, so a capability added
-- later is denied to every customised user unless their list is backfilled.
-- Anyone whose list lets them edit leads gets lead.create, which is what they
-- could already do. Idempotent: the @> guard makes a re-run a no-op.
UPDATE users
SET permissions = permissions || '["lead.create"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["lead.create"]'::jsonb
  AND (
    permissions @> '["lead.edit.assigned"]'::jsonb
    OR permissions @> '["lead.edit.all"]'::jsonb
  );
