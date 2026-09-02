-- Recurring expense templates + per-category monthly budgets (Network FP 8.2+).
-- Recurring templates let the firm define fixed monthly costs (rent, salaries,
-- software) once and post them to the ledger each month with one click, instead
-- of re-keying. Budgets drive the budget-vs-actual view. Both are additive and
-- tenant-scoped with RLS, mirroring business_expenses.

-- 1. Idempotency columns on the ledger so a template can post only once / month.
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS recurring_id uuid;
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS recurring_period text; -- 'YYYY-MM'
CREATE UNIQUE INDEX IF NOT EXISTS business_expenses_recurring_unique
  ON business_expenses (tenant_id, recurring_id, recurring_period)
  WHERE recurring_id IS NOT NULL;

-- 2. Recurring templates.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  description text NOT NULL,
  category text NOT NULL DEFAULT 'others',
  paid_from text NOT NULL DEFAULT 'current_account',
  amount numeric(18,2) NOT NULL,
  day_of_month integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_expenses_tenant_idx ON recurring_expenses (tenant_id);
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recurring_expenses;
CREATE POLICY tenant_isolation ON recurring_expenses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 3. Per-category monthly budgets.
CREATE TABLE IF NOT EXISTS expense_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  category text NOT NULL,
  monthly_budget numeric(18,2) NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_budgets_unique ON expense_budgets (tenant_id, category);
ALTER TABLE expense_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expense_budgets;
CREATE POLICY tenant_isolation ON expense_budgets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
