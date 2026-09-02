-- 0099_client_review_frequency
-- Per-client review cadence. When NULL, cadence is derived from the client's
-- service tier (A = quarterly, B = half-yearly, C = annual). When set, it drives
-- the next-review date. Modelled as a Drizzle text enum (app-level validation);
-- the column itself is plain text, consistent with the other *_cadence columns.
ALTER TABLE investors ADD COLUMN IF NOT EXISTS review_frequency text;
