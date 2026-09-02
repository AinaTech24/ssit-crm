-- Dashboard scale indexes (owner cockpit + streamed sections at 10k clients).
--
-- The cockpit aggregates filter transactions/sips by DATE inside a single
-- per-tenant query. Existing transaction indexes lead with type/investor
-- ((tenant_id,type,order_date), (tenant_id,investor_id,order_date)), so a pure
-- tenant+date-range scan (the OwnerCockpit "business" breakdown, NetSales 30-day
-- join on order_date, TopMovers order_date>=start) couldn't use any index and
-- seq-scanned the tenant's entire transaction history on every dashboard load.
--
-- Proven with an 80k-row probe: the "business" query dropped from a full
-- Parallel Seq Scan (~18ms @80k, linear in total history) to a Bitmap Heap Scan
-- of only the recent rows (~0.8ms, linear in MTD volume) once these existed.
--
--   transactions(tenant_id, order_date)  — business breakdown, NetSales, TopMovers
--   transactions(tenant_id, created_at)  — business sip_rejected branch + recent activity
--   sips(tenant_id, created_at)          — headline new-SIPs, TopMovers new SIPs, persistency
--
-- Plain CREATE INDEX (the migrate runner wraps each file in a transaction, so
-- CONCURRENTLY isn't available here). On a large production table, build these
-- CONCURRENTLY by hand instead. Idempotent.

CREATE INDEX IF NOT EXISTS transactions_tenant_order_date_idx
  ON transactions (tenant_id, order_date);

CREATE INDEX IF NOT EXISTS transactions_tenant_created_idx
  ON transactions (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS sips_tenant_created_idx
  ON sips (tenant_id, created_at);
