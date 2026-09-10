-- Brand accent default follows the logo red.
--
-- The product palette moved from navy/cyan to the red in the Equitywala logo
-- (#D22E32). `tenants.secondary_color` carried the old cyan as its COLUMN
-- DEFAULT, so every firm that never opened Settings -> Appearance was silently
-- stamped with a hex that is now off-brand.
--
-- Existing rows are deliberately NOT rewritten. A firm that genuinely picked
-- its own accent stores that choice in this same column, and there is no way to
-- tell "the old default" apart from "a firm that liked cyan" without guessing.
-- Overwriting would re-brand paying customers behind their backs. Instead
-- `resolveThemeColors()` in src/lib/branding/theme.ts treats the legacy value as
-- unbranded and falls back to the stock palette, so the estate renders red
-- while anyone who deliberately chose a colour keeps it. This statement only
-- changes what NEW tenants are stamped with.

ALTER TABLE tenants
  ALTER COLUMN secondary_color SET DEFAULT '#d22e32';
