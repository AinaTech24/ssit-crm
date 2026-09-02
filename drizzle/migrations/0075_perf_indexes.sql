-- Performance indexes.
--
-- transactions(scheme_code): the reverse side of every valuation / AUM / recon
-- join (LEFT JOIN scheme_nav ON n.scheme_code = t.scheme_code) was unindexed,
-- forcing scans on the set-based recompute + reconciliation CTEs at 10k clients.
--
-- investors(tenant_id, created_at): backs the new "Added" date-range list filter
-- and default created-order on a large client book.
--
-- Plain CREATE INDEX (the migrate runner wraps each file in a transaction, so
-- CONCURRENTLY isn't available here). On a large production table, build these
-- CONCURRENTLY by hand instead. Idempotent.

CREATE INDEX IF NOT EXISTS transactions_tenant_scheme_idx
  ON transactions (tenant_id, scheme_code);

CREATE INDEX IF NOT EXISTS investors_tenant_created_idx
  ON investors (tenant_id, created_at);
