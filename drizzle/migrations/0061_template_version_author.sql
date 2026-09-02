-- 0061 — Templates: record the author of each version (maker-checker)
--
-- The approval routes can now block a user from approving a template version
-- they authored themselves (segregation of duties). Nullable — existing
-- versions have no recorded author and are exempt from the self-approve guard.

ALTER TABLE template_versions
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);
