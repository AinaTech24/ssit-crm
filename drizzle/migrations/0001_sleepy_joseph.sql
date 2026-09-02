CREATE TABLE "blueprint_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_name" text NOT NULL,
	"blueprint_name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"blueprint_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"current_stage_key" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"is_delayed" boolean DEFAULT false NOT NULL,
	"delayed_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"duration_seconds" integer,
	"breached_sla" boolean DEFAULT false NOT NULL,
	"completed_by" uuid,
	"transition_name" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_stages" (
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
--> statement-breakpoint
CREATE TABLE "blueprint_transitions" (
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
--> statement-breakpoint
CREATE TABLE "lead_blueprint_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"blueprint_id" uuid NOT NULL,
	"current_stage_key" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"is_delayed" boolean DEFAULT false NOT NULL,
	"delayed_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"duration_seconds" integer,
	"breached_sla" boolean DEFAULT false NOT NULL,
	"completed_by" uuid,
	"transition_name" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dlt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dlt_template_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"pe_id" text NOT NULL,
	"template_type" text DEFAULT 'service' NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_profile_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"name" text DEFAULT 'Risk profile' NOT NULL,
	"description" text,
	"questions" jsonb NOT NULL,
	"bands" jsonb NOT NULL,
	"review_interval_days" integer DEFAULT 365 NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"result" jsonb,
	"created_by" uuid,
	"last_seen_ip" text,
	"last_seen_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"acceptance_text" text NOT NULL,
	"signature_name" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"share_token_id" uuid,
	"signed_document_url" text,
	"override_by_user_id" uuid,
	"override_reason" text,
	"meta" jsonb,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_schemes" (
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
	"suitability_status" text DEFAULT 'aligned' NOT NULL,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rta_file_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"file_size_bytes" integer,
	"file_checksum" text,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"parsed_at" timestamp with time zone,
	"rows_total" integer,
	"rows_imported" integer,
	"rows_skipped" integer,
	"rows_failed" integer,
	"errors" jsonb,
	"remarks" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events_outbox" ALTER COLUMN "attempts" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "review_meetings" ALTER COLUMN "investor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "joining_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reporting_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "annual_target" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sip_monthly_target" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "review_meetings" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "review_meetings" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "review_meetings" ADD COLUMN "outcome_notes" text;--> statement-breakpoint
ALTER TABLE "blueprint_definitions" ADD CONSTRAINT "blueprint_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_definitions" ADD CONSTRAINT "blueprint_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_instances" ADD CONSTRAINT "blueprint_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_instances" ADD CONSTRAINT "blueprint_instances_blueprint_id_blueprint_definitions_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_stage_history" ADD CONSTRAINT "blueprint_stage_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_stage_history" ADD CONSTRAINT "blueprint_stage_history_instance_id_blueprint_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."blueprint_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_stage_history" ADD CONSTRAINT "blueprint_stage_history_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_stages" ADD CONSTRAINT "blueprint_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_stages" ADD CONSTRAINT "blueprint_stages_blueprint_id_blueprint_definitions_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_transitions" ADD CONSTRAINT "blueprint_transitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_transitions" ADD CONSTRAINT "blueprint_transitions_blueprint_id_blueprint_definitions_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_blueprint_instances" ADD CONSTRAINT "lead_blueprint_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_blueprint_instances" ADD CONSTRAINT "lead_blueprint_instances_blueprint_id_blueprint_definitions_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_instance_id_lead_blueprint_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."lead_blueprint_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dlt_templates" ADD CONSTRAINT "dlt_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profile_templates" ADD CONSTRAINT "risk_profile_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profile_templates" ADD CONSTRAINT "risk_profile_templates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_override_by_user_id_users_id_fk" FOREIGN KEY ("override_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_schemes" ADD CONSTRAINT "proposal_schemes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_schemes" ADD CONSTRAINT "proposal_schemes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rta_file_imports" ADD CONSTRAINT "rta_file_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rta_file_imports" ADD CONSTRAINT "rta_file_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bd_module_idx" ON "blueprint_definitions" USING btree ("tenant_id","module_name","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "bd_tenant_name_unique" ON "blueprint_definitions" USING btree ("tenant_id","module_name","blueprint_name","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "bi_subject_unique" ON "blueprint_instances" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "bi_stage_idx" ON "blueprint_instances" USING btree ("tenant_id","current_stage_key","status");--> statement-breakpoint
CREATE INDEX "bi_blueprint_idx" ON "blueprint_instances" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "bsh_subject_idx" ON "blueprint_stage_history" USING btree ("tenant_id","subject_type","subject_id","entered_at");--> statement-breakpoint
CREATE INDEX "bsh_instance_idx" ON "blueprint_stage_history" USING btree ("instance_id","entered_at");--> statement-breakpoint
CREATE INDEX "bs_blueprint_idx" ON "blueprint_stages" USING btree ("blueprint_id","stage_order");--> statement-breakpoint
CREATE UNIQUE INDEX "bs_blueprint_key_unique" ON "blueprint_stages" USING btree ("blueprint_id","stage_key");--> statement-breakpoint
CREATE INDEX "bt_blueprint_idx" ON "blueprint_transitions" USING btree ("blueprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bt_blueprint_from_to_unique" ON "blueprint_transitions" USING btree ("blueprint_id","from_stage_key","to_stage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lbi_lead_unique" ON "lead_blueprint_instances" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "lbi_stage_idx" ON "lead_blueprint_instances" USING btree ("tenant_id","current_stage_key","status");--> statement-breakpoint
CREATE INDEX "lbi_delayed_idx" ON "lead_blueprint_instances" USING btree ("tenant_id","is_delayed");--> statement-breakpoint
CREATE INDEX "lsh_lead_idx" ON "lead_stage_history" USING btree ("tenant_id","lead_id","entered_at");--> statement-breakpoint
CREATE INDEX "lsh_instance_idx" ON "lead_stage_history" USING btree ("instance_id","entered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dlt_templates_id_unique" ON "dlt_templates" USING btree ("tenant_id","dlt_template_id");--> statement-breakpoint
CREATE INDEX "dlt_templates_tenant_idx" ON "dlt_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rpt_tenant_version_unique" ON "risk_profile_templates" USING btree ("tenant_id","version_number");--> statement-breakpoint
CREATE INDEX "rpt_active_idx" ON "risk_profile_templates" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "share_tokens_hash_unique" ON "share_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_tokens_subject_idx" ON "share_tokens" USING btree ("tenant_id","subject_type","subject_id","kind");--> statement-breakpoint
CREATE INDEX "share_tokens_expiry_idx" ON "share_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "proposal_approvals_proposal_idx" ON "proposal_approvals" USING btree ("proposal_id","accepted_at");--> statement-breakpoint
CREATE INDEX "proposal_approvals_tenant_idx" ON "proposal_approvals" USING btree ("tenant_id","accepted_at");--> statement-breakpoint
CREATE INDEX "proposal_schemes_proposal_idx" ON "proposal_schemes" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposal_schemes_suitability_idx" ON "proposal_schemes" USING btree ("tenant_id","suitability_status");--> statement-breakpoint
CREATE INDEX "rta_imports_kind_idx" ON "rta_file_imports" USING btree ("tenant_id","kind","period_end");--> statement-breakpoint
CREATE INDEX "rta_imports_status_idx" ON "rta_file_imports" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "rta_imports_dedupe_idx" ON "rta_file_imports" USING btree ("tenant_id","source","kind","period_end","file_checksum");--> statement-breakpoint
CREATE INDEX "users_tenant_department_idx" ON "users" USING btree ("tenant_id","department","status");--> statement-breakpoint
CREATE INDEX "users_reporting_manager_idx" ON "users" USING btree ("tenant_id","reporting_manager_id");
--> statement-breakpoint
ALTER TABLE "dlt_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dlt_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS dlt_templates_tenant_isolation ON "dlt_templates";
--> statement-breakpoint
CREATE POLICY dlt_templates_tenant_isolation ON "dlt_templates" FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');