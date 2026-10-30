-- AMC Meetings becomes its own sidebar item (/dashboard/amc-meetings).
--
-- Until now the meeting log was a tab inside AMC Empanelments, so anyone who had
-- that sidebar item could see meetings. A saved per-user list
-- (users.enabled_modules) and a package's granular feature list
-- (packages.enabled_features) are allow-lists, so a new item reads as "unticked"
-- for everyone who has one. Give it to exactly the people/packages that already
-- had AMC Empanelments, so nobody loses the meetings they could open yesterday.
-- Firm grants (subscriptions.allowed_nav) are protected by nav_grant_catalog and
-- need nothing.
--
-- Idempotent: the @> guards make a re-run a no-op.
UPDATE users
SET enabled_modules = enabled_modules || '["/dashboard/amc-meetings"]'::jsonb
WHERE enabled_modules IS NOT NULL
  AND jsonb_typeof(enabled_modules) = 'array'
  AND enabled_modules @> '["/dashboard/amc-empanelments"]'::jsonb
  AND NOT enabled_modules @> '["/dashboard/amc-meetings"]'::jsonb;

UPDATE packages
SET enabled_features = enabled_features || '["/dashboard/amc-meetings"]'::jsonb
WHERE jsonb_typeof(enabled_features) = 'array'
  AND jsonb_array_length(enabled_features) > 0
  AND enabled_features @> '["/dashboard/amc-empanelments"]'::jsonb
  AND NOT enabled_features @> '["/dashboard/amc-meetings"]'::jsonb;
