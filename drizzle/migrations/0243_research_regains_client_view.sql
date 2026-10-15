-- Research keeps its client view.
--
-- 0242 took investor.view.all away from ra_research users and out of their saved
-- custom permission lists. That change is reverted for research users (only the
-- firm admin's research dashboard changed), so the capability goes back into any
-- saved list that lost it — the same rule as 0231.
--
-- Idempotent: the @> guard makes a re-run a no-op.
UPDATE users
SET permissions = permissions || '["investor.view.all"]'::jsonb
WHERE permissions IS NOT NULL
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT permissions @> '["investor.view.all"]'::jsonb
  AND roles && ARRAY['ra_research']::text[];
