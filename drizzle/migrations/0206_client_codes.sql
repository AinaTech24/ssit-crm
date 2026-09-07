-- Client identifiers the firm actually files business under.
--
-- A client is onboarded through one of two books — Motilal Oswal or plain
-- Mutual Fund — and carries a code per platform they are registered with.
-- These are looked up, searched and quoted to the RTA, so they are real
-- columns rather than entries in the free-form `tags` jsonb: an identifier you
-- cannot index is an identifier you cannot find.
--
-- Own columns rather than reusing bse_ucc_code / nse_can_code, which are
-- exchange UCCs and mean something different.
--
-- The BOOK itself (Motilal Oswal / Mutual Fund) stays in `tags`. It is a label,
-- a client can carry both, and the list will grow.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS mf_code text,
  ADD COLUMN IF NOT EXISTS mo_code text,
  ADD COLUMN IF NOT EXISTS bajaj_code text,
  ADD COLUMN IF NOT EXISTS las_code text;

-- Lookup by code is the point of storing them. Partial: most clients hold only
-- one or two of the four, so indexing the NULLs would be dead weight.
CREATE INDEX IF NOT EXISTS investors_mf_code_idx ON investors (tenant_id, mf_code) WHERE mf_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS investors_mo_code_idx ON investors (tenant_id, mo_code) WHERE mo_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS investors_bajaj_code_idx ON investors (tenant_id, bajaj_code) WHERE bajaj_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS investors_las_code_idx ON investors (tenant_id, las_code) WHERE las_code IS NOT NULL;

COMMENT ON COLUMN investors.mf_code IS 'Mutual-fund book client code.';
COMMENT ON COLUMN investors.mo_code IS 'Motilal Oswal client code.';
COMMENT ON COLUMN investors.bajaj_code IS 'Bajaj client code.';
COMMENT ON COLUMN investors.las_code IS 'Loan Against Shares account code.';
