-- Activity tracker: an entry is several items with counts, not one item.
--
-- `item_type` held a single value from a dropdown, so "the Diwali campaign"
-- had to be logged as one row per artefact, or as a "Post" that silently
-- stood in for three posts, two flyers and a standee. Neither is countable,
-- which defeats the point of a tracker.
--
-- `items` stores what was actually produced:
--   [{"type":"post","qty":3},{"type":"other","label":"Standee","qty":1}]
-- `type` is a TRACKER_ITEM_TYPES value; `label` is only set for "other", where
-- the user names the thing themselves.
--
-- item_type is NOT dropped. Rows written before this migration have only that
-- column, and the UI falls back to it when `items` is null, so nothing that was
-- already logged loses its meaning. New rows populate both — item_type gets the
-- first selected type — so any existing query or export keeps working.

ALTER TABLE activity_entries
  ADD COLUMN IF NOT EXISTS items jsonb;

COMMENT ON COLUMN activity_entries.items IS
  'Items produced, as [{type, label?, qty}]. NULL for rows predating the multi-item form — read item_type instead.';
