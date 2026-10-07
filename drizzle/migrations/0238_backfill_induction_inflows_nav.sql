-- Induction and Expected Inflows join the sidebar-access catalogue.
--
-- Until now neither was in src/config/nav-access.ts, so neither could be
-- switched off: they were never gated, and showed in the sidebar for everyone
-- whatever the firm or the team member had unticked. Adding them makes them
-- controllable like every other module.
--
-- A saved per-user list (users.enabled_modules) and a package's granular
-- feature list (packages.enabled_features) are allow-lists, so an item that did
-- not exist when they were saved reads as "unticked". Left alone, this change
-- would hide both items from everyone who has a saved list. They could see them
-- before, so add them to existing lists: nobody loses anything today, and an
-- admin can now untick them. (Firm grants, subscriptions.allowed_nav, are
-- protected separately by nav_grant_catalog and need nothing.)
--
-- Idempotent: the @> guards make a re-run a no-op.
UPDATE users
SET enabled_modules = enabled_modules || '["/dashboard/induction"]'::jsonb
WHERE enabled_modules IS NOT NULL
  AND jsonb_typeof(enabled_modules) = 'array'
  AND NOT enabled_modules @> '["/dashboard/induction"]'::jsonb;

UPDATE users
SET enabled_modules = enabled_modules || '["/dashboard/expected-inflows"]'::jsonb
WHERE enabled_modules IS NOT NULL
  AND jsonb_typeof(enabled_modules) = 'array'
  AND NOT enabled_modules @> '["/dashboard/expected-inflows"]'::jsonb;

UPDATE packages
SET enabled_features = enabled_features || '["/dashboard/induction"]'::jsonb
WHERE jsonb_typeof(enabled_features) = 'array'
  AND jsonb_array_length(enabled_features) > 0
  AND NOT enabled_features @> '["/dashboard/induction"]'::jsonb;

UPDATE packages
SET enabled_features = enabled_features || '["/dashboard/expected-inflows"]'::jsonb
WHERE jsonb_typeof(enabled_features) = 'array'
  AND jsonb_array_length(enabled_features) > 0
  AND NOT enabled_features @> '["/dashboard/expected-inflows"]'::jsonb;
