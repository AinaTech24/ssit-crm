-- Per-user sidebar module access (Module-19 "modules like roles" access control).
--
-- NULL  = the team member inherits the full set of modules the tenant has
--         (no per-user restriction) — preserves existing behaviour for every
--         current user.
-- jsonb array = restrict this user to exactly these module keys (intersected
--         with the tenant's enabled modules at render time). Owners always get
--         the full tenant set regardless.
--
-- Set by the MFD owner in the employee form; enforced in the dashboard sidebar.
-- Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS enabled_modules jsonb;
