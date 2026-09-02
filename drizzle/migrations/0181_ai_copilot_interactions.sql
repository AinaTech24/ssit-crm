-- 0181 — SSIT CRM Copilot: interaction log (self-learning from user behaviour).
--
-- Every prompt is recorded with how it was answered (which intent handled it,
-- or a miss). This is the copilot's memory: it powers (a) learned routing —
-- a new phrasing the rules miss can be matched to a past HANDLED question's
-- intent — and (b) surfacing what the team actually asks, plus a review queue
-- of misses to turn into new rules over time.
--
-- Additive + idempotent. Tenant-scoped with RLS like every domain table.

CREATE TABLE IF NOT EXISTS ai_copilot_interactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid,
  question      text NOT NULL,
  question_norm text NOT NULL,
  handled       boolean NOT NULL DEFAULT false,
  intent        text,
  source        text,           -- engine | engine_learned | llm | fallback | miss
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aci_tenant_handled_idx ON ai_copilot_interactions (tenant_id, handled, created_at DESC);
CREATE INDEX IF NOT EXISTS aci_tenant_norm_idx    ON ai_copilot_interactions (tenant_id, question_norm);

ALTER TABLE ai_copilot_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_copilot_interactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_copilot_interactions;
CREATE POLICY tenant_isolation ON ai_copilot_interactions FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
