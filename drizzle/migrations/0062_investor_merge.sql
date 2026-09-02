-- 0062 — Investor duplicate-merge bookkeeping (Sanchay "Find Duplicate
-- Records" parity).
--
-- When two investor records for the same person are merged, all child rows
-- (folios, transactions, SIPs, activities, SRs, policies, leads, …) are
-- reassigned to the survivor and the loser is marked: status='inactive',
-- merged_into_id = survivor, merged_at = now(). These columns make the merge
-- traceable + let lists / dedupe exclude already-merged records.
--
-- Columns added to an existing table → no RLS change needed (investors already
-- carries tenant_isolation).

ALTER TABLE investors ADD COLUMN IF NOT EXISTS merged_into_id uuid;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS merged_at timestamptz;

CREATE INDEX IF NOT EXISTS investors_merged_into_idx ON investors (tenant_id, merged_into_id);
