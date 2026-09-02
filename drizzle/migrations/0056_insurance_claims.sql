-- 0056 — Insurance Claims tracker
--
-- Tracks a claim against a policy through its lifecycle (intimated → file
-- received → under process → settled / rejected). One row per claim; a policy
-- can have several over time. Links to insurance_policies + investors, with
-- denormalised policy_number / insurer / proposer_name for fast list render.

CREATE TABLE IF NOT EXISTS insurance_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid REFERENCES branches(id),
  policy_id       uuid REFERENCES insurance_policies(id),
  policy_number   text,
  insurer         text,
  investor_id     uuid REFERENCES investors(id),
  proposer_name   text NOT NULL,
  contact_person  text,
  email           text,
  phone           text,
  claim_status    text NOT NULL DEFAULT 'claim_intimated',
  policy_details  text,
  claim_type      text,
  claim_mode      text,
  intimation_mode text,
  submitted_mode  text,
  admission_date  date,
  intimation_date date,
  submission_date date,
  settlement_date date,
  claimed_amount  numeric(16,2) DEFAULT 0,
  settled_amount  numeric(16,2) DEFAULT 0,
  rm_id           uuid REFERENCES users(id),
  comments        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claims_tenant_idx   ON insurance_claims (tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS claims_status_idx   ON insurance_claims (tenant_id, claim_status);
CREATE INDEX IF NOT EXISTS claims_investor_idx ON insurance_claims (tenant_id, investor_id);
CREATE INDEX IF NOT EXISTS claims_policy_idx   ON insurance_claims (tenant_id, policy_id);

ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON insurance_claims;
CREATE POLICY tenant_isolation ON insurance_claims
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
