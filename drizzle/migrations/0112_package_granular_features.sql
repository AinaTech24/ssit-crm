-- Granular per-feature access + add-on pricing on packages.
--
-- Until now a package gated access at the COARSE module level (29 modules in
-- `enabled_modules`). This adds a GRANULAR layer keyed by sidebar-feature key
-- (the ~65 nav hrefs in src/config/nav-access.ts), so the SSIT package editor
-- can switch every individual feature Off / Included / Add-on and price each
-- add-on separately.
--
--   enabled_features : ["/dashboard/leads", "/dashboard/investors", ...]
--   addon_features   : [{ "key": "/dashboard/insurance", "monthlyPaise": 50000,
--                          "yearlyPaise": 500000 }, ...]
--
-- Resolution (lib/auth/license.ts + config/nav-access.ts):
--   subscriptions.allowed_nav  >  packages.enabled_features  >  enabled_modules
-- So a package left untouched (empty enabled_features) keeps its existing
-- coarse behaviour; only packages saved in the new granular editor use these.
--
-- Additive + idempotent. Prices in paise.

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS enabled_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS addon_features   jsonb NOT NULL DEFAULT '[]'::jsonb;
