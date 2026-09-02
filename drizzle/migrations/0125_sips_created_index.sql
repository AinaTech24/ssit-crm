-- 0125 — index sips by (tenant_id, created_at).
--
-- The "daily SIPs added" report filters `created_at >= now() - interval '30 days'`
-- and RLS layers on the tenant_id predicate, but sips only had status/investor/
-- end_date indexes — so this report fell back to a per-tenant scan + filter.

CREATE INDEX IF NOT EXISTS sips_tenant_created_idx ON sips (tenant_id, created_at);
