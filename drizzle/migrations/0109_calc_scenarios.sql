-- 0109 — Saved calculator scenarios. An RM builds an illustration in a client
-- meeting and saves it; next review they reload the exact inputs. One row per
-- saved scenario; `inputs` holds the calculator's full input state, `results`
-- an optional summary snapshot for list views.

CREATE TABLE IF NOT EXISTS calc_scenarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid REFERENCES users(id),
  investor_id    uuid REFERENCES investors(id),
  calculator_key text NOT NULL,
  title          text NOT NULL,
  inputs         jsonb NOT NULL,
  results        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calc_scenarios_user_idx ON calc_scenarios (tenant_id, user_id, calculator_key);
CREATE INDEX IF NOT EXISTS calc_scenarios_investor_idx ON calc_scenarios (tenant_id, investor_id);

ALTER TABLE calc_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE calc_scenarios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calc_scenarios;
CREATE POLICY tenant_isolation ON calc_scenarios FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
