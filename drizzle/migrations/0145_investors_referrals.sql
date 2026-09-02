-- Referrals on a client (investor) — people the client referred (prospective
-- leads / referral sources). Stored as a JSONB array, mirroring `nominees`.
-- Each entry: { name, relation?, mobile?, email?, note? }.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS referrals jsonb DEFAULT '[]'::jsonb;
