-- 0050 — SIP tracker: end-date index for the expiry scanner
--
-- The nightly scanner now finds active SIPs nearing their end_date to emit
-- `sip.expiring` (the renewal nudge). sips only had (tenant_id, status) and
-- (tenant_id, investor_id) — add the status+end_date lookup that pass uses.

CREATE INDEX IF NOT EXISTS sips_end_date_idx
  ON sips (tenant_id, status, end_date);
