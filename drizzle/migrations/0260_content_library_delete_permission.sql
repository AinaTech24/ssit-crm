-- Content Library gets its own "delete" capability, separate from "edit".
--
-- Until now removing a firm's own upload rode on content_library.edit. Delete is
-- now a capability of its own so an owner can hand out add / edit / delete one by
-- one. The role default (marketing) is unchanged in effect: marketing could remove
-- uploads before and still can.
--
-- A non-empty users.permissions is a strict ALLOW-LIST, so anyone with a saved
-- custom list who could remove uploads before (they hold content_library.edit)
-- gets the new capability appended, keeping what they could already do.
-- Idempotent: the @> guard makes a re-run a no-op.
UPDATE users
SET permissions = permissions || '["content_library.delete"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND permissions @> '["content_library.edit"]'::jsonb
  AND NOT permissions @> '["content_library.delete"]'::jsonb;
