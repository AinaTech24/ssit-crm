-- mf_schemes: platform-shared Mutual Fund scheme catalog, synced daily from
-- mfapi.in (https://api.mfapi.in/mf). Shared across ALL tenants (no tenant_id);
-- powers scheme/AMC autocomplete + scheme discovery. Complements scheme_nav
-- (AMFI latest-NAV feed).

CREATE TABLE IF NOT EXISTS mf_schemes (
  scheme_code     text PRIMARY KEY,            -- mfapi.in / AMFI scheme code
  scheme_name     text NOT NULL,
  fund_house      text,
  scheme_type     text,
  scheme_category text,
  isin            text,
  nav             numeric(14, 4),
  nav_date        date,
  is_active       boolean NOT NULL DEFAULT true,
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mf_schemes_name_idx ON mf_schemes (scheme_name);
CREATE INDEX IF NOT EXISTS mf_schemes_house_idx ON mf_schemes (fund_house);
CREATE INDEX IF NOT EXISTS mf_schemes_isin_idx ON mf_schemes (isin);

-- Platform-shared reference data: every tenant can READ; only the system /
-- platform admin can WRITE (same pattern as recipes + packages). The daily
-- worker writes it via withSystem() (app.is_platform_admin = true).
ALTER TABLE mf_schemes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mf_schemes_read ON mf_schemes;
CREATE POLICY mf_schemes_read ON mf_schemes FOR SELECT USING (true);
DROP POLICY IF EXISTS mf_schemes_write ON mf_schemes;
CREATE POLICY mf_schemes_write ON mf_schemes FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
