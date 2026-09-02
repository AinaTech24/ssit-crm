-- Multiple brand-logo variants per MFD firm, each mapped to where the software
-- actually uses a logo:
--   logo_url      (already exists) → full horizontal lockup (PDFs, emails, marketing)
--   favicon_url   (already exists) → browser tab icon
--   logo_icon_url (new)            → square app icon (sidebar badge, avatars)
--   logo_mark_url (new)            → compact monogram / "half" logo (collapsed sidebar, watermarks)
--
-- All nullable; a resolver (src/lib/branding/logo.ts) falls back across them so a
-- firm that uploaded only one logo still renders correctly everywhere.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_icon_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_mark_url text;
