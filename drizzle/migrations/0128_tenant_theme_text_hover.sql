-- 0128 — extra tenant theme controls (Batch 5).
--
-- Beyond primary (chrome) + secondary (accent), let a firm also set the body
-- TEXT colour and the HOVER / secondary-surface colour. Both optional hex
-- strings; when null the stock palette applies. Read at runtime by
-- buildTenantThemeCss → injected into the dashboard <style>.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS text_color text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hover_color text;
