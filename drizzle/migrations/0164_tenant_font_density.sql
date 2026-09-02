-- 0164: deeper theming — per-tenant font family + UI density, on top of the
-- existing brand colours. Both nullable (null = stock Inter / comfortable).
-- Additive + idempotent.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS font_family text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ui_density text;
