-- 0122 — free the ARN of tenants that were soft-deleted BEFORE the delete
-- endpoint learned to release it. The unique index tenants_arn_unique keeps a
-- soft-deleted (hidden) row's ARN reserved, which blocks re-creating a tenant
-- with that same ARN. Suffix those ARNs (only the ones not already suffixed) so
-- the original ARN becomes reusable. Idempotent — re-running is a no-op.

UPDATE tenants
SET arn = arn || '_deleted_' || to_char(COALESCE(deleted_at, now()), 'YYYYMMDDHH24MISS'),
    updated_at = now()
WHERE deleted_at IS NOT NULL
  AND position('_deleted_' in arn) = 0;
