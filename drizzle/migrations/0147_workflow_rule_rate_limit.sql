-- 0147 — Per-rule safety throttle. Max event-triggered firings per trailing
-- hour (NULL = unlimited) to guard against a pathological high-frequency rule
-- firing a comms storm / burning the per-tenant message quota.

ALTER TABLE workflow_rules
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour integer;
