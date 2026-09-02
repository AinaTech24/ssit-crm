-- 0162: per-tenant vanity subdomain + fully custom domain for white-labeling.
--   subdomain      → serves the CRM at "<subdomain>.<APP_BASE_DOMAIN>"
--                    (e.g. wecare.crm.ssit.com)
--   custom_domain  → the firm's own domain (e.g. crm.wecarewealth.in), premium.
-- Both are nullable + globally unique (case-insensitive). Additive + idempotent;
-- existing tenants keep serving on the shared domain until they claim one.
-- RLS already covers tenants (tenant_isolation) — no policy change for the table.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_verified_at timestamptz;

-- Case-insensitive uniqueness (hosts are case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_uq ON tenants (lower(subdomain)) WHERE subdomain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_custom_domain_uq ON tenants (lower(custom_domain)) WHERE custom_domain IS NOT NULL;
