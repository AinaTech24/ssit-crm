-- AMFI DDQ compliance registers — the operational records the Due Diligence
-- Questionnaire demands that the CRM had no home for. Refs are DDQ question
-- numbers (AMFI DDQ, Non-Individual).
--
-- Firm model note: an MFD giving "incidental advice" (advice incidental to
-- distribution, no separate advisory fee, no RIA registration) must be able to
-- show BOTH suitability records AND that no execution/advisory fee is charged
-- (DDQ 2.4c) — hence charges_execution_fees on tenants.
-- All additive + idempotent.

-- ── Per-client compliance fields ─────────────────────────────────────────────
-- 2.1c relationship category · 4.11c UBO · 4.13 IPV
ALTER TABLE investors ADD COLUMN IF NOT EXISTS relationship_category text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS ubo_status text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS ubo_collected_at date;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS ipv_status text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS ipv_date date;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS ipv_by_user_id uuid;

CREATE INDEX IF NOT EXISTS investors_ubo_status_idx ON investors (tenant_id, ubo_status);
CREATE INDEX IF NOT EXISTS investors_ipv_status_idx ON investors (tenant_id, ipv_status);

-- ── Firm-level DDQ declarations ──────────────────────────────────────────────
-- 2.1c/2.5 relationship model · 2.4c execution fees · 5.8 tagline · 5.9 SMP
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS relationship_model text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS charges_execution_fees boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS amfi_tagline_compliant boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS social_media_disclosure_compliant boolean NOT NULL DEFAULT false;

-- ── DDQ 4.26 — annual Declaration of Self-Certification (self + sub-distributors)
CREATE TABLE IF NOT EXISTS dsc_declarations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  financial_year      text NOT NULL,               -- '2026-27'
  subject_type        text NOT NULL DEFAULT 'self',-- self | sub_distributor
  sub_distributor_id  uuid,
  subject_name        text,
  arn                 text,
  status              text NOT NULL DEFAULT 'pending', -- pending | submitted | acknowledged
  submitted_on        date,
  document_url        text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dsc_tenant_fy_idx ON dsc_declarations (tenant_id, financial_year);

-- ── DDQ 4.17/4.18 mis-selling · 4.20b third-party payment · 6.1/6.2/6.3 legal
-- One register with a `kind` discriminator — same lifecycle, different trigger.
CREATE TABLE IF NOT EXISTS compliance_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  kind              text NOT NULL,  -- misselling | third_party_payment |
                                    -- regulatory_action | litigation |
                                    -- arn_euin_suspension | warning_letter
  occurred_on       date NOT NULL,
  title             text NOT NULL,
  description       text,
  investor_id       uuid,
  employee_user_id  uuid,
  amc_name          text,
  reported_to_amc   boolean NOT NULL DEFAULT false,
  reported_on       date,
  status            text NOT NULL DEFAULT 'open', -- open | under_review | resolved | closed
  remedial_action   text,
  resolution        text,
  closed_on         date,
  document_url      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comp_incidents_tenant_kind_idx ON compliance_incidents (tenant_id, kind, occurred_on);

-- ── DDQ 2.4b — unsuitability communication + client acknowledgement +
-- "execution only notwithstanding" confirmation. The mis-selling defence.
CREATE TABLE IF NOT EXISTS unsuitability_acks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  investor_id               uuid NOT NULL,
  scheme_name               text,
  transaction_ref           text,
  reason                    text NOT NULL,          -- why it's unsuitable
  communicated_on           date NOT NULL,
  channel                   text,                   -- email | whatsapp | letter | in_person
  client_acknowledged       boolean NOT NULL DEFAULT false,
  acknowledged_on           date,
  execution_only_confirmed  boolean NOT NULL DEFAULT false,
  confirmed_on              date,
  document_url              text,
  notes                     text,
  created_by_user_id        uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unsuit_tenant_investor_idx ON unsuitability_acks (tenant_id, investor_id);

-- ── RLS (every tenant_id table needs it — see check:rls) ─────────────────────
ALTER TABLE dsc_declarations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsc_declarations     FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dsc_declarations;
CREATE POLICY tenant_isolation ON dsc_declarations FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE compliance_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_incidents FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON compliance_incidents;
CREATE POLICY tenant_isolation ON compliance_incidents FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE unsuitability_acks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE unsuitability_acks   FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unsuitability_acks;
CREATE POLICY tenant_isolation ON unsuitability_acks FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
