-- Capture the AMFI NAVAll fields we were previously discarding.
--
-- The feed groups schemes under section headers that state the scheme STRUCTURE
-- ("Open Ended" / "Close Ended" / "Interval") and the GRANULAR CATEGORY
-- ("Equity Scheme - Flexi Cap Fund"), and each data row carries TWO ISINs
-- (Payout/Growth and Dividend-Reinvestment). The parser dropped the header and
-- the second ISIN; we now persist all of it so the per-tenant Scheme Master can
-- classify the FULL universe (not just the mfapi-matched subset) and so RTA/folio
-- matching can resolve a holding by either ISIN.
--
-- scheme_nav is platform-shared reference data with NO tenant_id / NO RLS, so a
-- plain ALTER is sufficient (no policy changes).

ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS isin_reinvest text;
ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS scheme_type text;
ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS scheme_category text;
