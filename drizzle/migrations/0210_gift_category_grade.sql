-- Client engagement: gifts get a CATEGORY and a GRADE, and remember the RM.
--
-- Firms buy gifts from a fixed catalogue — a hamper, a cake, a plant — each in
-- a small number of grades that map to what the firm spends. Free-text `title`
-- could not be counted or budgeted against, so "how many AA hampers went out
-- this month, and from whose desk" was unanswerable.
--
-- rm_id is a SNAPSHOT of the client's assigned RM at the moment the gift was
-- logged, not a live join. Clients get reassigned; the engagement report is
-- about who sent what at the time, and re-pointing history at a new RM would
-- silently rewrite last year's numbers.
--
-- Valid grades per category (hamper/plant A|AA|AAA, cake A|AA) are enforced in
-- the API rather than as a CHECK, so a firm adding a category later does not
-- need a migration to do it.

ALTER TABLE client_gifts
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS rm_id uuid REFERENCES users(id);

-- Drives the per-RM day / month / year counters on the engagement dashboard.
CREATE INDEX IF NOT EXISTS client_gifts_rm_idx
  ON client_gifts (tenant_id, rm_id, given_on DESC);

-- Drives the category/grade breakdown and the engagement calendar.
CREATE INDEX IF NOT EXISTS client_gifts_category_idx
  ON client_gifts (tenant_id, category, given_on DESC);

COMMENT ON COLUMN client_gifts.category IS
  'Gift catalogue category: hamper | cake | plant. NULL for rows logged before the catalogue existed.';
COMMENT ON COLUMN client_gifts.grade IS
  'Grade within the category: A | AA | AAA (cake has no AAA).';
COMMENT ON COLUMN client_gifts.rm_id IS
  'The client''s assigned RM when the gift was logged. Snapshot, not a live join.';
