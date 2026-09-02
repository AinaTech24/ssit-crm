-- 0057 — Investor list: indexes for the hot sort/filter columns
--
-- The clients list is the most-hit page. Its DEFAULT sort is `aum DESC`, with
-- alternate sorts on active_sip_amount and next_review_at, and it filters by
-- status / kyc_status / service_tier. None of these had an index, so at
-- 10K clients per tenant every list load did a full sort/scan. These
-- (tenant_id, col) composites let Postgres serve the ordered/filtered list
-- straight from the index. `status='active'` in particular is used by almost
-- every investor query in the app.

CREATE INDEX IF NOT EXISTS investors_aum_idx          ON investors (tenant_id, aum);
CREATE INDEX IF NOT EXISTS investors_sip_idx          ON investors (tenant_id, active_sip_amount);
CREATE INDEX IF NOT EXISTS investors_next_review_idx  ON investors (tenant_id, next_review_at);
CREATE INDEX IF NOT EXISTS investors_status_idx       ON investors (tenant_id, status);
CREATE INDEX IF NOT EXISTS investors_kyc_idx          ON investors (tenant_id, kyc_status);
CREATE INDEX IF NOT EXISTS investors_tier_idx         ON investors (tenant_id, service_tier);
