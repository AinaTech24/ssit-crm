-- Client Category (A/B/C/D) — a manually-assigned client classification on the
-- Clients module, distinct from the auto-computed service_tier (A/B/C) and the
-- entity-type investor_category (Individual/HUF/…). Nullable = unclassified.
-- text column (Drizzle enum is code-only, no DB CHECK) so values stay flexible.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS client_category text;

CREATE INDEX IF NOT EXISTS investors_client_category_idx ON investors (tenant_id, client_category);
