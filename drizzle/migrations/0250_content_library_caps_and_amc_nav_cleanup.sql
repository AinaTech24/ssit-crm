-- 1. Content Library gets three capabilities: view / add / edit.
--
-- Until now the library page and its list API were not gated at all, uploading
-- rode on template.edit, and a firm user had no way to edit or remove anything.
-- The role defaults give view to every staff role, and add/edit to marketing —
-- exactly who could use it before — so nothing changes for uncustomised users.
--
-- A non-empty users.permissions is a strict ALLOW-LIST, so a capability added
-- later is denied to every customised user unless their list is backfilled:
--   view  -> everyone with a custom list (they could open the library before)
--   add   -> anyone holding template.edit (what gated uploading before)
--   edit  -> the same people (editing did not exist; marketing-equivalent only)
-- Idempotent: the @> guards make a re-run a no-op.
UPDATE users
SET permissions = permissions || '["content_library.view"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["content_library.view"]'::jsonb;

UPDATE users
SET permissions = permissions || '["content_library.add"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND permissions @> '["template.edit"]'::jsonb
  AND NOT permissions @> '["content_library.add"]'::jsonb;

UPDATE users
SET permissions = permissions || '["content_library.edit"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND permissions @> '["template.edit"]'::jsonb
  AND NOT permissions @> '["content_library.edit"]'::jsonb;

-- 2. Undo the separate "AMC Meetings" sidebar item added in 0249.
--
-- AMC meetings stay a tab inside AMC Empanelments, governed by the AMC meeting
-- capabilities. The extra key is not in the sidebar catalogue any more, and a
-- saved list containing an unknown key can be refused when it is next saved.
UPDATE users
SET enabled_modules = enabled_modules - '/dashboard/amc-meetings'
WHERE enabled_modules IS NOT NULL
  AND jsonb_typeof(enabled_modules) = 'array'
  AND enabled_modules @> '["/dashboard/amc-meetings"]'::jsonb;

UPDATE packages
SET enabled_features = enabled_features - '/dashboard/amc-meetings'
WHERE jsonb_typeof(enabled_features) = 'array'
  AND enabled_features @> '["/dashboard/amc-meetings"]'::jsonb;

UPDATE subscriptions
SET allowed_nav = allowed_nav - '/dashboard/amc-meetings'
WHERE allowed_nav IS NOT NULL
  AND jsonb_typeof(allowed_nav) = 'array'
  AND allowed_nav @> '["/dashboard/amc-meetings"]'::jsonb;

UPDATE subscriptions
SET nav_grant_catalog = nav_grant_catalog - '/dashboard/amc-meetings'
WHERE nav_grant_catalog IS NOT NULL
  AND jsonb_typeof(nav_grant_catalog) = 'array'
  AND nav_grant_catalog @> '["/dashboard/amc-meetings"]'::jsonb;
