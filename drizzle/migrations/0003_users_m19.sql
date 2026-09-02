-- Module 19: Employee / Team Management — add 6 spec columns to users.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "department" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joining_date" date;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reporting_manager_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "annual_target" numeric(18, 2);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sip_monthly_target" numeric(18, 2);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notes" text;

CREATE INDEX IF NOT EXISTS "users_tenant_department_idx" ON "users" ("tenant_id", "department", "status");
CREATE INDEX IF NOT EXISTS "users_reporting_manager_idx" ON "users" ("tenant_id", "reporting_manager_id");
