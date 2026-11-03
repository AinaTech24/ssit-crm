-- Dhandho gets a separate "view" capability (dhandho.view) next to "add / edit"
-- (dhandho.manage), so an owner can control each per person.
--
-- A non-empty users.permissions is a strict ALLOW-LIST (can() never consults the
-- role matrix for those users), so a capability added later is denied to every
-- customised user unless their list is backfilled. Until now the Dhandho page was
-- open to every member, so every customised user keeps seeing it: give them the
-- new view capability. Anyone who already holds the manage capability keeps it
-- untouched. Idempotent (@> guard); an owner who unticks it later is not
-- overridden, because this runs once per database.
UPDATE users
SET permissions = permissions || '["dhandho.view"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["dhandho.view"]'::jsonb;
