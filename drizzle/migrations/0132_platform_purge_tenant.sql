-- Permanent (hard) delete of a tenant and ALL its data.
--
-- Soft delete (deleted_at) is the default and reversible path. This function is
-- the explicit, irreversible purge used by the platform-admin "permanent delete"
-- action on already-soft-deleted tenants.
--
-- Domain tables FK-reference tenants(id) via their tenant_id column and also
-- reference each other, so a single fixed delete order can't be hand-written
-- safely. Instead we delete every tenant_id-scoped table in repeated passes,
-- skipping (and retrying) any table still blocked by a child FK, until a pass
-- completes with no FK violations — then the tenant row itself. Runs inside the
-- caller's transaction, so any failure rolls the whole purge back atomically.

CREATE OR REPLACE FUNCTION platform_purge_tenant(p_tenant uuid) RETURNS void AS $$
DECLARE
  tbls text[];
  t text;
  blocked boolean;
  pass int := 0;
BEGIN
  SELECT array_agg(c.table_name) INTO tbls
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema
   AND tb.table_name = c.table_name
   AND tb.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id';

  IF tbls IS NOT NULL THEN
    LOOP
      pass := pass + 1;
      blocked := false;
      FOREACH t IN ARRAY tbls LOOP
        BEGIN
          EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', t) USING p_tenant;
        EXCEPTION WHEN foreign_key_violation THEN
          blocked := true;  -- a child table still references these rows; retry next pass
        END;
      END LOOP;
      EXIT WHEN NOT blocked;
      EXIT WHEN pass > 60;  -- safety stop for any cyclic FK graph
    END LOOP;

    IF blocked THEN
      RAISE EXCEPTION 'platform_purge_tenant: unresolved FK dependencies for tenant % after % passes', p_tenant, pass;
    END IF;
  END IF;

  DELETE FROM tenants WHERE id = p_tenant;
END;
$$ LANGUAGE plpgsql;
