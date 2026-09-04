-- Vartify replaces the two legacy WhatsApp providers.
--
-- `tenant_integrations.provider` is a plain text column with the enum enforced
-- in the Drizzle schema (not a Postgres enum type), so there is no type to ALTER
-- — adding "vartify" to the TS enum is sufficient for new rows. This migration
-- carries the DATA move: any firm that had a legacy WhatsApp integration
-- row is re-pointed at the new provider id so their connection keeps working
-- rather than silently reverting to "not connected".
--
-- The api_key stored against the old row is a legacy key and will NOT authenticate
-- against Vartify, so the row is carried over DISABLED: the firm must paste their
-- Vartify token in Settings → Integrations. Disabling (rather than deleting) keeps
-- the audit trail of what was previously configured.

UPDATE tenant_integrations
   SET provider   = 'vartify',
       is_active  = false,
       updated_at = now()
 WHERE provider IN ('waina', 'aisensy');

-- Old rows for BOTH legacy providers could collide on the unique
-- (tenant_id, provider) / (tenant_id, user_id, provider) indexes once both map to
-- 'vartify'. Collapse duplicates, keeping the most recently updated row.
DELETE FROM tenant_integrations a
 USING tenant_integrations b
 WHERE a.provider = 'vartify'
   AND b.provider = 'vartify'
   AND a.tenant_id = b.tenant_id
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND (a.updated_at, a.id) < (b.updated_at, b.id);
