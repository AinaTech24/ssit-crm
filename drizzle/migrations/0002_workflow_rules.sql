-- Zoho-CRM-style Workflow Rules.
-- Adds three new tables: workflow_rules, workflow_rule_executions, workflow_rule_scheduled_jobs.

CREATE TABLE IF NOT EXISTS "workflow_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "module" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "trigger_type" text NOT NULL,
  "trigger_config" jsonb NOT NULL,
  "criteria_pattern" text,
  "criteria_rows" jsonb DEFAULT '[]'::jsonb,
  "instant_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "scheduled_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "locked" boolean NOT NULL DEFAULT false,
  "lock_reason" text,
  "locked_by" uuid,
  "locked_at" timestamp with time zone,
  "execution_order" integer NOT NULL DEFAULT 100,
  "execution_count" integer NOT NULL DEFAULT 0,
  "last_executed_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wr_module_idx" ON "workflow_rules" ("tenant_id", "module", "enabled");
CREATE INDEX IF NOT EXISTS "wr_trigger_idx" ON "workflow_rules" ("module", "trigger_type", "enabled");
CREATE INDEX IF NOT EXISTS "wr_order_idx" ON "workflow_rules" ("tenant_id", "module", "execution_order");
CREATE UNIQUE INDEX IF NOT EXISTS "wr_tenant_name_unique" ON "workflow_rules" ("tenant_id", "module", "name");

DO $$ BEGIN
  ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_locked_by_users_id_fk"
    FOREIGN KEY ("locked_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "workflow_rule_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "rule_id" uuid NOT NULL,
  "triggered_by" text NOT NULL,
  "trigger_event_id" text,
  "subject_type" text,
  "subject_id" uuid,
  "context_snapshot" jsonb,
  "instant_outcomes" jsonb DEFAULT '[]'::jsonb,
  "scheduled_queued" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'succeeded',
  "error" text,
  "executed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wre_rule_idx" ON "workflow_rule_executions" ("rule_id", "executed_at");
CREATE INDEX IF NOT EXISTS "wre_subject_idx" ON "workflow_rule_executions" ("tenant_id", "subject_type", "subject_id");

DO $$ BEGIN
  ALTER TABLE "workflow_rule_executions" ADD CONSTRAINT "wre_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_rule_executions" ADD CONSTRAINT "wre_rule_id_fk"
    FOREIGN KEY ("rule_id") REFERENCES "workflow_rules"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "workflow_rule_scheduled_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "rule_id" uuid NOT NULL,
  "execution_id" uuid,
  "action_index" integer NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "action_type" text NOT NULL,
  "action_config" jsonb NOT NULL,
  "run_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "cancel_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wrsj_due_idx" ON "workflow_rule_scheduled_jobs" ("run_at") WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS "wrsj_rule_subject_idx" ON "workflow_rule_scheduled_jobs" ("rule_id", "subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "wrsj_status_idx" ON "workflow_rule_scheduled_jobs" ("status", "run_at");

DO $$ BEGIN
  ALTER TABLE "workflow_rule_scheduled_jobs" ADD CONSTRAINT "wrsj_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_rule_scheduled_jobs" ADD CONSTRAINT "wrsj_rule_id_fk"
    FOREIGN KEY ("rule_id") REFERENCES "workflow_rules"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_rule_scheduled_jobs" ADD CONSTRAINT "wrsj_execution_id_fk"
    FOREIGN KEY ("execution_id") REFERENCES "workflow_rule_executions"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

-- ============================================================================
-- RLS — tenant isolation matching all other domain tables.
-- ============================================================================

ALTER TABLE "workflow_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_rules";
CREATE POLICY tenant_isolation ON "workflow_rules" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "workflow_rule_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_rule_executions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_rule_executions";
CREATE POLICY tenant_isolation ON "workflow_rule_executions" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "workflow_rule_scheduled_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_rule_scheduled_jobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_rule_scheduled_jobs";
CREATE POLICY tenant_isolation ON "workflow_rule_scheduled_jobs" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
