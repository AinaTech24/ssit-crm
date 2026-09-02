-- 0137: make PAN uniqueness OPT-IN so the bulk Excel importer can load a book
-- that legitimately carries the same PAN on multiple rows.
--
-- A new `dedup_pan` flag (default true) governs participation in the unique
-- index. RTA-feed, manual create, and lead-convert keep it true → PAN stays
-- unique there. The Excel importer writes it false → duplicate PANs allowed.
--
-- The index is recreated as a PARTIAL unique index but keeps the SAME NAME
-- (`investors_tenant_pan_unique`) so existing error-handling that matches on
-- that name continues to work.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS dedup_pan boolean NOT NULL DEFAULT true;

DROP INDEX IF EXISTS investors_tenant_pan_unique;

CREATE UNIQUE INDEX investors_tenant_pan_unique
  ON investors (tenant_id, pan)
  WHERE dedup_pan AND pan IS NOT NULL;
