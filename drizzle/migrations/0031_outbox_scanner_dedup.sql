-- P1 RELIABILITY: make the daily-ops-scanner idempotent at the source.
--
-- The scanner emits birthday / anniversary / KYC-expiry / licence-expiry
-- events once per calendar day. Its docstring CLAIMED the outbox poller
-- dedupes by (kind, entity_id, scanDate) — but no such dedup exists in the
-- poller. So if the scanner runs twice in a day (master-scheduler retry, a
-- manual re-run, two worker replicas racing), every recipe fires twice:
-- duplicate birthday WhatsApps, double KYC nudges, etc.
--
-- Fix the invariant where it belongs — the write. Every scanner row carries
-- meta.source='daily-ops-scanner' and meta.scanDate='YYYY-MM-DD'. This PARTIAL
-- unique index makes (tenant_id, kind, entity_id, scanDate) unique *for scanner
-- rows only*. Normal app-mutation events (no scanDate, different source) are
-- untouched and may legitimately repeat. The scanner's INSERTs now use
-- ON CONFLICT DO NOTHING against this index, so a same-day re-run is a no-op.
--
-- Idempotent: IF NOT EXISTS guards re-application.

CREATE UNIQUE INDEX IF NOT EXISTS events_outbox_scanner_dedup_idx
  ON events_outbox (tenant_id, kind, entity_id, (meta ->> 'scanDate'))
  WHERE meta ->> 'source' = 'daily-ops-scanner';
