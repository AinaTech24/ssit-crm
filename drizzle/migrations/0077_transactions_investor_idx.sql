-- Per-client valuation / capital-gains / SIP-bounce queries filter
-- `transactions.investor_id` but, when the query carries no explicit tenant
-- predicate (valueInvestor relies on RLS; system-context jobs bypass RLS), the
-- composite (tenant_id, investor_id) index can't be used and Postgres
-- seq-scans the whole transactions table per client. A plain investor_id index
-- guarantees an index scan in every context — critical for Client-360, the
-- public portfolio link, statements, and the FIFO capital-gains engine on a
-- heavy-trading book. Idempotent; build CONCURRENTLY by hand on a huge table.

CREATE INDEX IF NOT EXISTS transactions_investor_idx
  ON transactions (investor_id);
