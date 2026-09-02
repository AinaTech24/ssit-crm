-- Business Closing Entries — manual ledger of booked business (MF/PMS/AIF/SIF/…)
-- with a scheme sub-form. Powers client confirmation emails, the business
-- dashboard, and the Liquid-for-switching report.

CREATE TABLE IF NOT EXISTS business_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  investor_id   uuid REFERENCES investors(id),
  client_name   text NOT NULL,
  product_type  text NOT NULL DEFAULT 'mutual_fund',
  business_date date NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  rm_id         uuid REFERENCES users(id),
  amc_name      text,
  folio_no      text,
  total_amount  numeric(18, 2) NOT NULL DEFAULT 0,
  asset_breakup jsonb,
  liquid_net    numeric(18, 2) NOT NULL DEFAULT 0,
  notes         text,
  emailed_at    timestamptz,
  created_by_id uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_entries_tenant_date_idx ON business_entries (tenant_id, business_date);
CREATE INDEX IF NOT EXISTS business_entries_investor_idx ON business_entries (tenant_id, investor_id);
CREATE INDEX IF NOT EXISTS business_entries_rm_idx ON business_entries (tenant_id, rm_id);
CREATE INDEX IF NOT EXISTS business_entries_status_idx ON business_entries (tenant_id, status);

CREATE TABLE IF NOT EXISTS business_entry_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  entry_id         uuid NOT NULL REFERENCES business_entries(id) ON DELETE CASCADE,
  scheme_code      text,
  scheme_name      text NOT NULL,
  amc_name         text,
  asset_category   text,
  asset_class      text NOT NULL DEFAULT 'other',
  txn_type         text NOT NULL DEFAULT 'lumpsum',
  amount           numeric(18, 2) NOT NULL DEFAULT 0,
  units            numeric(18, 4),
  frequency        text,
  from_scheme_code text,
  from_scheme_name text,
  from_asset_class text,
  folio_no         text,
  notes            text,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_entry_lines_entry_idx ON business_entry_lines (entry_id, sort_order);
CREATE INDEX IF NOT EXISTS business_entry_lines_class_idx ON business_entry_lines (tenant_id, asset_class);

-- RLS: both tables are tenant-scoped. We create the standard tenant_isolation
-- policy directly here (identical to the loop in 0001_rls_policies.sql) so this
-- migration is self-sufficient on both fresh + already-migrated databases —
-- without having to edit (and re-checksum) the long-applied 0001 file.
ALTER TABLE business_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_entries;
CREATE POLICY tenant_isolation ON business_entries FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE business_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_entry_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_entry_lines;
CREATE POLICY tenant_isolation ON business_entry_lines FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
