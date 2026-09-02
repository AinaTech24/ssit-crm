-- Onboarding flow — lead-to-client journey support.
--
-- 1. share_tokens         — single-use signed URLs for public client forms
-- 2. proposal_approvals   — SEBI-grade acceptance evidence
-- 3. review_meetings.outcome — meeting outcome enum (ready / more_info / not_ready / no_show)
-- 4. leads — add risk_profiled / docs_requested / docs_received as valid stages
--   (the column is text not enum, so the change is in the application code only)

-- ── 1. share_tokens ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "share_tokens" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "share_tokens_hash_unique" ON "share_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "share_tokens_subject_idx" ON "share_tokens" ("tenant_id", "subject_type", "subject_id", "kind");
CREATE INDEX IF NOT EXISTS "share_tokens_expiry_idx" ON "share_tokens" ("expires_at");

DO $$ BEGIN
  ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

ALTER TABLE "share_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "share_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "share_tokens";
CREATE POLICY tenant_isolation ON "share_tokens" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- ── 2. proposal_approvals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "proposal_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "acceptance_text" text NOT NULL,
  "signature_name" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'email',
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

CREATE INDEX IF NOT EXISTS "proposal_approvals_proposal_idx" ON "proposal_approvals" ("proposal_id", "accepted_at");
CREATE INDEX IF NOT EXISTS "proposal_approvals_tenant_idx" ON "proposal_approvals" ("tenant_id", "accepted_at");

DO $$ BEGIN
  ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_override_by_fk"
    FOREIGN KEY ("override_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN END $$;

ALTER TABLE "proposal_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposal_approvals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "proposal_approvals";
CREATE POLICY tenant_isolation ON "proposal_approvals" FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- ── 3. review_meetings.outcome ───────────────────────────────────────────
ALTER TABLE "review_meetings" ADD COLUMN IF NOT EXISTS "outcome" text;
ALTER TABLE "review_meetings" ADD COLUMN IF NOT EXISTS "outcome_notes" text;
