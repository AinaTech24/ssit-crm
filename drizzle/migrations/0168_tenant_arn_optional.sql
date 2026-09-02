-- ARN is now OPTIONAL when a platform admin provisions a tenant (some firms are
-- onboarded before their ARN is issued / for non-ARN entities). The unique index
-- stays — Postgres treats NULLs as distinct, so multiple ARN-less tenants coexist.
ALTER TABLE tenants ALTER COLUMN arn DROP NOT NULL;
