-- Per-client custom review cadence in DAYS (e.g. 50, 100). Overrides the
-- review_frequency preset enum when set. Nullable; no RLS change needed (the
-- investors table already has tenant_isolation).
ALTER TABLE investors ADD COLUMN IF NOT EXISTS review_frequency_days integer;
