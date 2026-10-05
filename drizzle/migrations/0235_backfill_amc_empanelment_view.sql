-- Give customised branch heads the AMC Empanelments view.
--
-- Same trap as 0225, 0226, 0228 and 0231: a non-empty users.permissions is a
-- strict ALLOW-LIST, so a capability the role holds by default can still be
-- missing from a list saved before it existed — and then reads as "unticked".
-- The sidebar item is gated by ROLE, so the page appeared in the menu and then
-- threw on open for exactly those users.
--
-- Read-only: amc_empanelment.view opens the list and detail pages. Editing still
-- needs compliance.edit.
--
-- Idempotent: the @> guard makes a re-run a no-op, and it runs once per
-- database, so an owner who later unticks it does not have it handed back.
UPDATE users
SET permissions = permissions || '["amc_empanelment.view"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["amc_empanelment.view"]'::jsonb
  AND roles && ARRAY['branch_head']::text[];
