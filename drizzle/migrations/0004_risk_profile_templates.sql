-- Tenant-editable risk-profile templates.

CREATE TABLE IF NOT EXISTS "risk_profile_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "version_number" integer NOT NULL DEFAULT 1,
  "is_active" boolean NOT NULL DEFAULT true,
  "name" text NOT NULL DEFAULT 'Risk profile',
  "description" text,
  "questions" jsonb NOT NULL,
  "bands" jsonb NOT NULL,
  "review_interval_days" integer NOT NULL DEFAULT 365,
  "published_by" uuid,
  "published_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpt_tenant_version_unique" ON "risk_profile_templates" ("tenant_id", "version_number");
CREATE INDEX IF NOT EXISTS "rpt_active_idx" ON "risk_profile_templates" ("tenant_id", "is_active");

DO $$ BEGIN
  ALTER TABLE "risk_profile_templates" ADD CONSTRAINT "rpt_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "risk_profile_templates" ADD CONSTRAINT "rpt_published_by_fk"
    FOREIGN KEY ("published_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

ALTER TABLE "risk_profile_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_profile_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "risk_profile_templates";
CREATE POLICY tenant_isolation ON "risk_profile_templates" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
