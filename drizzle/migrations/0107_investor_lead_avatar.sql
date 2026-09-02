-- Optional avatar / photo for investors and leads.
-- Additive + idempotent; served via /api/investors/[id]/avatar and
-- /api/leads/[id]/avatar (storage key in the S3 "general" kind, or an
-- external URL). Never mandatory.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS avatar_url text;
