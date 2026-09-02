-- 0160: allow a financial plan to belong to a LEAD as well as an investor — so
-- an advisor can build & save a plan for a prospect before they convert.
-- Additive + idempotent + blue-green safe: relaxing investor_id NOT NULL and
-- adding a nullable lead_id doesn't break existing rows or the currently-running
-- code (which always sets investor_id). RLS already covers financial_plans
-- (tenant_isolation) — no policy change needed for an existing table.

ALTER TABLE financial_plans ALTER COLUMN investor_id DROP NOT NULL;
ALTER TABLE financial_plans ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id);
CREATE INDEX IF NOT EXISTS financial_plans_lead_idx ON financial_plans (tenant_id, lead_id);

-- Exactly one subject (investor XOR lead). Existing rows have investor_id set and
-- lead_id NULL → num_nonnulls = 1, so the constraint validates cleanly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_plans_one_subject_chk') THEN
    ALTER TABLE financial_plans
      ADD CONSTRAINT financial_plans_one_subject_chk
      CHECK (num_nonnulls(investor_id, lead_id) = 1);
  END IF;
END $$;
