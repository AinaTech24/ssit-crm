-- Client-service fields on investors.
--
--  statement_cadence      how often we auto-send this client their portfolio
--                         statement: 'off' | 'monthly' | 'quarterly'. Default
--                         'off' so nothing goes out until the firm opts a client
--                         in (consent + intent), but the whole book can be turned
--                         on at once.
--  last_statement_sent_at watermark so the scheduler sends once per period.
--  language_pref          preferred language for client comms (ISO code, e.g.
--                         'en','hi','gu','mr','ta','te','kn','bn'). Messages are
--                         translated to this at send time.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS statement_cadence text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS last_statement_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS language_pref text NOT NULL DEFAULT 'en',
  -- highest AUM "moment that matters" band reached (0=<10L,1=10L,2=25L,3=50L,
  -- 4=1Cr,5=2.5Cr,6=5Cr) so a milestone congratulation fires once per crossing.
  ADD COLUMN IF NOT EXISTS aum_milestone_band integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS investors_statement_cadence_idx
  ON investors (tenant_id, statement_cadence, last_statement_sent_at);
