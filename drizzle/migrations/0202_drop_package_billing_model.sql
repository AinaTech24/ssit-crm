-- Remove the package / trial / renewal model.
--
-- Equitywala provisions firms directly; it does not sell them plans. What the
-- platform actually uses from the old `subscriptions` row is the per-tenant
-- ACCESS OVERRIDE set that Equitywala Admin → Module & Field Access Center
-- writes: allowed_nav, allowed_fields, allowed_dashboard_widgets,
-- modules_override and feature_flags_override.
--
-- So the row survives as an access-override record and everything billing-shaped
-- is decoupled:
--
--   * package_id stops being NOT NULL and loses its FK to `packages`, so a firm
--     can have an override row without any plan behind it. (Every new tenant now
--     gets one at creation — that is what makes the sidebar toggles work.)
--   * The status/trial/renewal columns are LEFT IN PLACE but no longer read.
--     Dropping them would destroy the historical record for no benefit, and
--     `tenants.status` is now the authoritative on/off switch (see
--     src/lib/auth/license.ts).
--
-- The `packages` table is likewise left in place, unreferenced. Nothing reads it.

ALTER TABLE subscriptions ALTER COLUMN package_id DROP NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN package_key DROP NOT NULL;

-- The FK name is Drizzle-generated; drop it defensively so this is re-runnable
-- and tolerant of a differently-named constraint.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'subscriptions'
      AND con.contype = 'f'
      AND pg_get_constraintdef(con.oid) LIKE '%REFERENCES packages%'
  LOOP
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', c);
  END LOOP;
END$$;

-- Backfill an access-override row for every tenant that lacks one, so a platform
-- admin can start toggling sidebar access for existing firms immediately rather
-- than hitting "subscription not found".
INSERT INTO subscriptions (id, tenant_id, status, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'active', now(), now()
FROM tenants t
WHERE t.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);

COMMENT ON TABLE subscriptions IS
  'Per-tenant ACCESS OVERRIDE record (allowed_nav / allowed_fields / allowed_dashboard_widgets / modules_override / feature_flags_override). The package, billing and licence-window columns are legacy and unread.';
