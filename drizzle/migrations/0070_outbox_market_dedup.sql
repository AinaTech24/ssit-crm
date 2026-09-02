-- Market-scanner idempotency — same pattern as 0031 (daily-ops-scanner dedup).
--
-- The market scanner emits one `market.nifty_drop` event per marketing-opted-in
-- investor when NIFTY falls past the threshold. The worker ticks hourly, so on a
-- down day it would re-emit every hour without a guard. Each market-scanner row
-- carries meta.source='market-scanner' and meta.scanDate='YYYY-MM-DD'; this
-- PARTIAL unique index makes (tenant_id, kind, entity_id, scanDate) unique for
-- those rows only, and the INSERT uses ON CONFLICT DO NOTHING — so a client gets
-- at most one stay-invested nudge per drop day, no matter how often the scan runs.
--
-- Idempotent: IF NOT EXISTS guards re-application.

CREATE UNIQUE INDEX IF NOT EXISTS events_outbox_market_dedup_idx
  ON events_outbox (tenant_id, kind, entity_id, (meta ->> 'scanDate'))
  WHERE meta ->> 'source' = 'market-scanner';
