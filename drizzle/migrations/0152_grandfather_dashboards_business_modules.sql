-- 0152 — Grandfather the two newly-gated modules ('dashboards', 'business_entries')
-- into every EXISTING package + subscription override, so adding their sidebar
-- module-gating doesn't suddenly hide these pre-existing features from current
-- tenants. Idempotent (the `@>` guard skips rows already carrying the modules);
-- only touches non-empty module lists (an empty list already means "allow all").

UPDATE packages
SET enabled_modules = enabled_modules || '["dashboards","business_entries"]'::jsonb
WHERE jsonb_typeof(enabled_modules) = 'array'
  AND jsonb_array_length(enabled_modules) > 0
  AND NOT (enabled_modules @> '["business_entries"]'::jsonb);

UPDATE subscriptions
SET modules_override = modules_override || '["dashboards","business_entries"]'::jsonb
WHERE modules_override IS NOT NULL
  AND jsonb_typeof(modules_override) = 'array'
  AND jsonb_array_length(modules_override) > 0
  AND NOT (modules_override @> '["business_entries"]'::jsonb);
