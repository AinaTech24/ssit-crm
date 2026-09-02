-- Proposal extras: suitability note + expiry workflow + versioning.

ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "suitability_note" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "suitability_override_reason" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "suitability_override_by_user_id" uuid;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "suitability_override_at" timestamp with time zone;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "parent_proposal_id" uuid;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "is_expired" boolean NOT NULL DEFAULT false;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "expired_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "proposals_parent_idx" ON "proposals" ("parent_proposal_id");
CREATE INDEX IF NOT EXISTS "proposals_expiry_idx" ON "proposals" ("tenant_id", "valid_until") WHERE is_expired = false;

DO $$ BEGIN
  ALTER TABLE "proposals" ADD CONSTRAINT "proposals_suitability_override_by_fk"
    FOREIGN KEY ("suitability_override_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

-- Per-line scheme suitability (replaces / augments the line_items jsonb when
-- the RM needs auditable per-scheme decisions).
CREATE TABLE IF NOT EXISTS "proposal_schemes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "amc" text,
  "scheme_name" text NOT NULL,
  "scheme_code" text,
  "scheme_category" text,
  "asset_class" text,
  "scheme_risk_level" text,
  "sip_amount" numeric(14, 2),
  "lumpsum_amount" numeric(14, 2),
  "expected_return_pct" numeric(5, 2),
  "expected_holding_years" integer,
  "suitability_status" text NOT NULL DEFAULT 'aligned',
  "override_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "proposal_schemes_proposal_idx" ON "proposal_schemes" ("proposal_id");
CREATE INDEX IF NOT EXISTS "proposal_schemes_suitability_idx" ON "proposal_schemes" ("tenant_id", "suitability_status");

DO $$ BEGIN
  ALTER TABLE "proposal_schemes" ADD CONSTRAINT "proposal_schemes_proposal_id_fk"
    FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;

ALTER TABLE "proposal_schemes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposal_schemes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "proposal_schemes";
CREATE POLICY tenant_isolation ON "proposal_schemes" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- Tasks: dependency_task_id to model "UCC depends on KYC complete" etc.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "dependency_task_id" uuid;
CREATE INDEX IF NOT EXISTS "tasks_dependency_idx" ON "tasks" ("dependency_task_id") WHERE dependency_task_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dependency_task_id_fk"
    FOREIGN KEY ("dependency_task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
