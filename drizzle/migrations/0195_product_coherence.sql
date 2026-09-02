CREATE TABLE IF NOT EXISTS investor_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  investor_id uuid NOT NULL REFERENCES investors(id),
  token_hash text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["portfolio","goals","service_requests"]'::jsonb,
  created_by_user_id uuid REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS investor_portal_access_token_hash_unique
  ON investor_portal_access(token_hash);
CREATE INDEX IF NOT EXISTS investor_portal_access_investor_idx
  ON investor_portal_access(tenant_id, investor_id);
CREATE INDEX IF NOT EXISTS investor_portal_access_expiry_idx
  ON investor_portal_access(expires_at);

CREATE TABLE IF NOT EXISTS business_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  investor_id uuid REFERENCES investors(id),
  recorded_by_user_id uuid REFERENCES users(id),
  source_type text NOT NULL CHECK (source_type IN ('workflow','campaign','next_best_action','service','meeting','manual')),
  source_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('aum_protected','aum_generated','sip_recovered','sip_started','referral_won','service_recovery')),
  amount numeric(18,2) NOT NULL DEFAULT 0,
  monthly_sip_amount numeric(18,2) NOT NULL DEFAULT 0,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_impacts_occurred_idx
  ON business_impacts(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS business_impacts_investor_idx
  ON business_impacts(tenant_id, investor_id);
CREATE INDEX IF NOT EXISTS business_impacts_source_idx
  ON business_impacts(tenant_id, source_type);

ALTER TABLE investor_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_portal_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON investor_portal_access;
CREATE POLICY tenant_isolation ON investor_portal_access FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE business_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_impacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_impacts;
CREATE POLICY tenant_isolation ON business_impacts FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

