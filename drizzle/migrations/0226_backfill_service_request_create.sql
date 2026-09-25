-- Give service_request.create to customised users whose list predates it.
--
-- Same trap as 0225: a non-empty users.permissions is a strict ALLOW-LIST, so
-- a capability added later cannot appear in a list saved earlier and reads as
-- "unticked" forever, whatever the role matrix says. Without this, the RMs and
-- branch heads whose access was customised would keep getting
-- "forbidden: missing service_request.manage" while uncustomised colleagues on
-- the same role could log tickets.
--
-- Granted to the same people the role matrix now grants it to: anyone whose
-- roles are client-servicing, plus anyone already holding .manage (back office
-- could always create). A list belonging to marketing, research or gifting/HR
-- is left alone — they don't service client requests.
--
-- Idempotent: the @> guard makes a re-run a no-op, and it runs once per
-- database, so an owner who later unticks this does not have it handed back.
UPDATE users
SET permissions = permissions || '["service_request.create"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["service_request.create"]'::jsonb
  AND (
    permissions @> '["service_request.manage"]'::jsonb
    OR roles && ARRAY['back_office','ops','rm','sub_broker','branch_head','assistant','ria','insurance','compliance']::text[]
  );
