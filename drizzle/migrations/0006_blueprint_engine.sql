-- Blueprint engine — formal stage machines for end-to-end journeys.

CREATE TABLE IF NOT EXISTS "blueprint_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "module_name" text NOT NULL,
  "blueprint_name" text NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "version_number" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bd_module_idx" ON "blueprint_definitions" ("tenant_id", "module_name", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "bd_tenant_name_unique" ON "blueprint_definitions" ("tenant_id", "module_name", "blueprint_name", "version_number");

DO $$ BEGIN
  ALTER TABLE "blueprint_definitions" ADD CONSTRAINT "bd_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "blueprint_definitions" ADD CONSTRAINT "bd_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "blueprint_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "blueprint_id" uuid NOT NULL,
  "stage_key" text NOT NULL,
  "stage_name" text NOT NULL,
  "description" text,
  "stage_order" integer NOT NULL,
  "owner_role" text,
  "required_fields" jsonb DEFAULT '[]'::jsonb,
  "sla_days" integer,
  "enter_conditions" jsonb,
  "exit_conditions" jsonb,
  "allowed_actions" jsonb DEFAULT '[]'::jsonb,
  "automations_on_enter" jsonb DEFAULT '[]'::jsonb,
  "automations_on_exit" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bs_blueprint_idx" ON "blueprint_stages" ("blueprint_id", "stage_order");
CREATE UNIQUE INDEX IF NOT EXISTS "bs_blueprint_key_unique" ON "blueprint_stages" ("blueprint_id", "stage_key");

DO $$ BEGIN
  ALTER TABLE "blueprint_stages" ADD CONSTRAINT "bs_blueprint_id_fk"
    FOREIGN KEY ("blueprint_id") REFERENCES "blueprint_definitions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "blueprint_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "blueprint_id" uuid NOT NULL,
  "from_stage_key" text NOT NULL,
  "to_stage_key" text NOT NULL,
  "transition_name" text NOT NULL,
  "required_conditions" jsonb,
  "allowed_roles" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bt_blueprint_idx" ON "blueprint_transitions" ("blueprint_id");
CREATE UNIQUE INDEX IF NOT EXISTS "bt_blueprint_from_to_unique" ON "blueprint_transitions" ("blueprint_id", "from_stage_key", "to_stage_key");

DO $$ BEGIN
  ALTER TABLE "blueprint_transitions" ADD CONSTRAINT "bt_blueprint_id_fk"
    FOREIGN KEY ("blueprint_id") REFERENCES "blueprint_definitions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "lead_blueprint_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "blueprint_id" uuid NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS "lbi_lead_unique" ON "lead_blueprint_instances" ("tenant_id", "lead_id");
CREATE INDEX IF NOT EXISTS "lbi_stage_idx" ON "lead_blueprint_instances" ("tenant_id", "current_stage_key", "status");
CREATE INDEX IF NOT EXISTS "lbi_delayed_idx" ON "lead_blueprint_instances" ("tenant_id", "is_delayed");

DO $$ BEGIN
  ALTER TABLE "lead_blueprint_instances" ADD CONSTRAINT "lbi_blueprint_id_fk"
    FOREIGN KEY ("blueprint_id") REFERENCES "blueprint_definitions"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE IF NOT EXISTS "lead_stage_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
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

CREATE INDEX IF NOT EXISTS "lsh_lead_idx" ON "lead_stage_history" ("tenant_id", "lead_id", "entered_at");
CREATE INDEX IF NOT EXISTS "lsh_instance_idx" ON "lead_stage_history" ("instance_id", "entered_at");

DO $$ BEGIN
  ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lsh_instance_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "lead_blueprint_instances"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lsh_completed_by_fk"
    FOREIGN KEY ("completed_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

-- RLS
ALTER TABLE "blueprint_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blueprint_definitions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "blueprint_definitions";
CREATE POLICY tenant_isolation ON "blueprint_definitions" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "blueprint_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blueprint_stages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "blueprint_stages";
CREATE POLICY tenant_isolation ON "blueprint_stages" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "blueprint_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blueprint_transitions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "blueprint_transitions";
CREATE POLICY tenant_isolation ON "blueprint_transitions" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "lead_blueprint_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_blueprint_instances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lead_blueprint_instances";
CREATE POLICY tenant_isolation ON "lead_blueprint_instances" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE "lead_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_stage_history" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lead_stage_history";
CREATE POLICY tenant_isolation ON "lead_stage_history" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
