-- FEATURE: live NAV reference data for portfolio valuation + XIRR.
--
-- Platform-shared market data — NOT tenant-scoped (every MFD values the same
-- scheme with the same NAV). Like recipes/packages/content_library_assets it
-- has NO tenant_id and NO RLS policy; it's universal reference data read by all
-- tenants. The RLS CI guard only inspects tables WITH a tenant_id, so this is
-- correctly out of scope there.
--
-- Keyed by AMFI scheme code (what folios/transactions store in scheme_code),
-- so valuation is a straight join. Populated daily from AMFI's public NAVAll
-- feed (src/lib/finance/nav-feed.ts). Idempotent.

CREATE TABLE IF NOT EXISTS scheme_nav (
  scheme_code text PRIMARY KEY,
  isin        text,
  scheme_name text NOT NULL,
  amc_name    text,
  nav         numeric(14,4) NOT NULL,
  nav_date    date NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheme_nav_isin_idx ON scheme_nav (isin);
CREATE INDEX IF NOT EXISTS scheme_nav_name_idx ON scheme_nav (scheme_name);
