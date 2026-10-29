-- AMC meetings: how it was held (online / offline / office), who is tagged on it,
-- and an optional branch it was tagged to. Tagged people and branches are told
-- through an announcement that only they can see, so announcements gain a
-- per-person audience (NULL / empty = everyone the other scopes allow, as before).
ALTER TABLE amc_meetings ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE amc_meetings ADD COLUMN IF NOT EXISTS collaborator_user_ids jsonb;
ALTER TABLE amc_meetings ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience_user_ids jsonb;
