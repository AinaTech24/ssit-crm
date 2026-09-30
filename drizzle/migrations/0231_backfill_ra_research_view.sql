-- Give customised RA-Research users the two capabilities their new views need.
--
-- Same trap as 0225, 0226 and 0228: a non-empty users.permissions is a strict
-- ALLOW-LIST, so a capability the role gains LATER can never appear in a list
-- saved EARLIER and reads as "unticked" forever. Without this, a customised
-- research user would open the new dashboard sections to an empty screen while
-- an uncustomised colleague on the same role saw them.
--
--   investor.view.all              read the book to analyse it — client counts,
--                                  reviews due, portfolio split by RM
--   review_meeting.manage.assigned open the Meetings module at all
--
-- Both are READ/own-records capabilities. Nothing here lets research edit a
-- client or somebody else's meeting.
--
-- Idempotent: the @> guards make a re-run a no-op, and it runs once per
-- database, so an owner who later unticks either does not have it handed back.
UPDATE users
SET permissions = permissions || '["investor.view.all"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["investor.view.all"]'::jsonb
  AND roles && ARRAY['ra_research']::text[];

UPDATE users
SET permissions = permissions || '["review_meeting.manage.assigned"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["review_meeting.manage.assigned"]'::jsonb
  AND roles && ARRAY['ra_research']::text[];
