-- Add-on modules on packages.
--
-- A module can now be in one of three states for a package:
--   • Included  — listed in `enabled_modules`, free with the package
--   • Add-on    — listed in `addon_modules` with its own recurring price; the
--                 MFD can buy it on top of the base package
--   • Off       — in neither list, not offered
--
-- `addon_modules` shape:
--   [{ "module": "broadcasts", "monthlyPaise": 50000, "yearlyPaise": 500000 }, ...]
-- Prices in paise (₹1 = 100 paise), matching the other price columns.
--
-- Additive + idempotent — defaults to an empty array so existing packages are
-- unaffected (everything stays Included / Off as before).

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS addon_modules jsonb NOT NULL DEFAULT '[]'::jsonb;
