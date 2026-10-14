-- Research no longer reads the client book.
--
-- 0231 gave ra_research investor.view.all so its dashboard could count clients
-- and reviews. Research does not work the book — it works the meetings assigned
-- to it and the ones it assigns on — so that capability is taken back out of
-- the role matrix (rbac.ts) and out of any saved custom permission list.
--
-- Only people whose access comes from ra_research alone are touched: someone who
-- also holds a role that legitimately reads all clients keeps it.
--
-- Idempotent.
UPDATE users
SET permissions = permissions - 'investor.view.all'
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND permissions @> '["investor.view.all"]'::jsonb
  AND roles && ARRAY['ra_research']::text[]
  AND NOT roles && ARRAY['owner', 'compliance', 'back_office', 'ops', 'gifting_hr']::text[];
