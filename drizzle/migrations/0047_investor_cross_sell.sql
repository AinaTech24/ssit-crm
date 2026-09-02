-- Cross-sell / product-holdings matrix per client (adopted from the Sanchay
-- "Cross Selling" tab). A JSONB map of product -> status, e.g.
--   { "mutual_funds": "held_with_us", "life_insurance": "held_elsewhere",
--     "health_insurance": "not_held", "nps": "interested" }
--
-- Statuses: held_with_us | held_elsewhere | interested | not_held | not_applicable
-- "held_elsewhere", "interested" and "not_held" are wallet-share OPPORTUNITIES.
--
-- `investors` is already an RLS-protected domain table — additive column, no
-- new policy required.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS cross_sell jsonb;
