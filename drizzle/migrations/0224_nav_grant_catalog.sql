-- The per-firm sidebar grant (subscriptions.allowed_nav) stores the exact
-- hrefs an Equitywala admin ticked. That makes it a FROZEN LIST: every sidebar
-- item shipped after that save is missing from it, so the firm loses the module
-- forever and the owner cannot even grant it to a team member -- the employee
-- Sidebar Access picker draws its pool from the same list. Referrals,
-- Opportunities and Client Engagement all vanished this way.
--
-- Record the catalogue the admin was actually choosing from at save time. A
-- grant then means "these are the items I excluded, out of the ones I could
-- see" instead of "these are the only items that will ever exist".
--
-- NULL = unknown vintage (every row written before this migration). Those are
-- read as "the admin never had the chance to exclude anything new", so items
-- the firm's package enables come back. The next save in the Access Center
-- stamps the catalogue and exclusions stick from then on.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS nav_grant_catalog jsonb;

COMMENT ON COLUMN subscriptions.nav_grant_catalog IS
  'Snapshot of every known sidebar nav key at the moment allowed_nav was last saved. NULL = pre-0224 grant of unknown vintage.';
