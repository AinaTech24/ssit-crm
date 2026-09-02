-- Generalise the blueprint engine: blueprint_instances + blueprint_stage_history
-- accept any subject_type. The lead-specific tables stay as a thin alias for
-- back-compat code; new modules use the polymorphic tables.

CREATE TABLE IF NOT EXISTS "blueprint_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "blueprint_id" uuid NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "current_stage_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'in_progress',
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "is_delayed" boolean NOT NULL DEFAULT false,
  "delayed_since" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "bi_subject_unique" ON "blueprint_instances" ("tenant_id", "subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "bi_stage_idx" ON "blueprint_instances" ("tenant_id", "current_stage_key", "status");
CREATE INDEX IF NOT EXISTS "bi_delayed_idx" ON "blueprint_instances" ("tenant_id", "is_delayed");
CREATE INDEX IF NOT EXISTS "bi_blueprint_idx" ON "blueprint_instances" ("blueprint_id");

DO $$ BEGIN
  ALTER TABLE "blueprint_instances" ADD CONSTRAINT "bi_blueprint_id_fk"
    FOREIGN KEY ("blueprint_id") REFERENCES "blueprint_definitions"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "blueprint_stage_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "instance_id" uuid NOT NULL,
  "stage_key" text NOT NULL,
  "entered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "exited_at" timestamp with time zone,
  "duration_seconds" integer,
  "breached_sla" boolean NOT NULL DEFAULT false,
  "completed_by" uuid,
  "transition_name" text,
  "remarks" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bsh_subject_idx" ON "blueprint_stage_history" ("tenant_id", "subject_type", "subject_id", "entered_at");
CREATE INDEX IF NOT EXISTS "bsh_instance_idx" ON "blueprint_stage_history" ("instance_id", "entered_at");

DO $$ BEGIN
  ALTER TABLE "blueprint_stage_history" ADD CONSTRAINT "bsh_instance_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "blueprint_instances"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "blueprint_stage_history" ADD CONSTRAINT "bsh_completed_by_fk"
    FOREIGN KEY ("completed_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

ALTER TABLE "blueprint_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blueprint_instances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "blueprint_instances";
CREATE POLICY tenant_isolation ON "blueprint_instances" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "blueprint_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blueprint_stage_history" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "blueprint_stage_history";
CREATE POLICY tenant_isolation ON "blueprint_stage_history" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- Backfill: copy existing lead_blueprint_instances + lead_stage_history into
-- the new polymorphic tables so back-compat is preserved.
INSERT INTO blueprint_instances (
  id, tenant_id, blueprint_id, subject_type, subject_id, current_stage_key,
  status, started_at, stage_entered_at, completed_at, is_delayed, delayed_since,
  created_at, updated_at
)
SELECT
  id, tenant_id, blueprint_id, 'lead', lead_id, current_stage_key,
  status, started_at, stage_entered_at, completed_at, is_delayed, delayed_since,
  created_at, updated_at
FROM lead_blueprint_instances
ON CONFLICT (id) DO NOTHING;

INSERT INTO blueprint_stage_history (
  id, tenant_id, subject_type, subject_id, instance_id, stage_key,
  entered_at, exited_at, duration_seconds, breached_sla, completed_by,
  transition_name, remarks, created_at, updated_at
)
SELECT
  id, tenant_id, 'lead', lead_id, instance_id, stage_key,
  entered_at, exited_at, duration_seconds, breached_sla, completed_by,
  transition_name, remarks, created_at, updated_at
FROM lead_stage_history
ON CONFLICT (id) DO NOTHING;
