-- 0045 — Financial plans: status index
--
-- The list page now filters by status in SQL (it previously loaded every plan
-- and filtered in JS). financial_plans only had (tenant_id, investor_id) and
-- (tenant_id, plan_number) — add the tenant-scoped status lookup the list uses.

CREATE INDEX IF NOT EXISTS financial_plans_status_idx
  ON financial_plans (tenant_id, status);
