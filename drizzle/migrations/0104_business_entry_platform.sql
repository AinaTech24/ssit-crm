-- 0104 — Add execution-venue / distribution platform to business entries
-- (Finowise MIS idea). Powers the Net-Sales matrix by Product × Platform ×
-- Asset class. Nullable text; no backfill.

ALTER TABLE business_entries ADD COLUMN IF NOT EXISTS platform text;
CREATE INDEX IF NOT EXISTS business_entries_platform_idx ON business_entries (tenant_id, platform);
