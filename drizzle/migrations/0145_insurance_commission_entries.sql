-- 0145 — Manual insurance commission ledger. Actual commission RECEIVED
-- (first-year / trail / override / bonus) with TDS + net, optionally linked to a
-- policy / client, for reconciliation against the estimated per-policy book.

CREATE TABLE IF NOT EXISTS insurance_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  entry_date date NOT NULL,
  insurer text,
  policy_id uuid,
  policy_number text,
  investor_id uuid,
  commission_type text NOT NULL DEFAULT 'first_year',
  gross_amount numeric(16,2) NOT NULL DEFAULT 0,
  tds_amount numeric(16,2) NOT NULL DEFAULT 0,
  net_amount numeric(16,2) NOT NULL DEFAULT 0,
  period_label text,
  reference_no text,
  notes text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ins_comm_entry_date_idx ON insurance_commission_entries (tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS ins_comm_entry_insurer_idx ON insurance_commission_entries (tenant_id, insurer);
CREATE INDEX IF NOT EXISTS ins_comm_entry_policy_idx ON insurance_commission_entries (tenant_id, policy_id);

ALTER TABLE insurance_commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_commission_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON insurance_commission_entries FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
