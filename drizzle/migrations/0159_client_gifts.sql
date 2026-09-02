-- Per-client gift tracking: an allocated birthday-gift budget on the investor
-- + a log of gifts given (birthday / anniversary / festival / other). Additive
-- + idempotent. The budget is a raw ALTER (no investors.ts schema change — same
-- approach as 0158); client_gifts is a new tenant-scoped table with RLS.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS birthday_gift_budget integer;

CREATE TABLE IF NOT EXISTS client_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  investor_id uuid NOT NULL REFERENCES investors(id),
  occasion text NOT NULL DEFAULT 'birthday',
  title text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  given_on date NOT NULL,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_gifts_investor_idx ON client_gifts (tenant_id, investor_id, given_on DESC);

ALTER TABLE client_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_gifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_gifts;
CREATE POLICY tenant_isolation ON client_gifts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
