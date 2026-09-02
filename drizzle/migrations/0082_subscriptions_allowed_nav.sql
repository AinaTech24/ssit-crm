-- Admin → MFD sidebar access (Module-19 "modules like roles, but per sidebar item").
--
-- The set of sidebar nav hrefs the firm can open (see src/config/nav-access.ts).
-- NULL = the package-module default (legacy behaviour preserved). Set by SSIT
-- platform admins in the super-admin tenant access panel.
--
-- Pairs with users.enabled_modules (migration 0081), which stores the per-user
-- (MFD → team member) subset of these hrefs.
-- Idempotent.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS allowed_nav jsonb;
