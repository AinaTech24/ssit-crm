-- platform_purge_tenant: report WHAT blocked the purge, and don't spin silently.
--
-- The previous version swallowed every foreign_key_violation and, after 60
-- passes, raised a message that named no table — so an operator saw only
-- "internal" in the UI and the server log carried drizzle's query dump with the
-- real cause hidden on err.cause. This version:
--
--   * remembers which tables were still blocked on the final pass and names
--     them in the exception,
--   * stops as soon as a pass makes no progress (a further 50 identical passes
--     cannot help), instead of grinding to the pass cap while holding locks,
--   * keeps the same delete-in-repeated-passes strategy, which is what makes
--     the FK order self-resolving.

CREATE OR REPLACE FUNCTION platform_purge_tenant(p_tenant uuid) RETURNS void AS $$
DECLARE
  tbls text[];
  t text;
  blocked_now text[];
  blocked_prev text[] := ARRAY[]::text[];
  deleted_any boolean;
  n bigint;
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
      blocked_now := ARRAY[]::text[];
      deleted_any := false;

      FOREACH t IN ARRAY tbls LOOP
        BEGIN
          EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', t) USING p_tenant;
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN deleted_any := true; END IF;
        EXCEPTION WHEN foreign_key_violation THEN
          -- A child table still references these rows; retry on the next pass.
          blocked_now := blocked_now || t;
        END;
      END LOOP;

      EXIT WHEN array_length(blocked_now, 1) IS NULL;  -- clean pass: done

      -- No rows deleted AND the same tables blocked as last pass → the graph
      -- cannot resolve itself. Fail now with the names rather than spinning.
      IF NOT deleted_any AND blocked_now = blocked_prev THEN
        RAISE EXCEPTION
          'platform_purge_tenant: cannot delete tenant % — still blocked by foreign keys on: %',
          p_tenant, array_to_string(blocked_now, ', ');
      END IF;

      blocked_prev := blocked_now;

      IF pass > 60 THEN
        RAISE EXCEPTION
          'platform_purge_tenant: gave up after % passes for tenant % — still blocked by: %',
          pass, p_tenant, array_to_string(blocked_now, ', ');
      END IF;
    END LOOP;
  END IF;

  DELETE FROM tenants WHERE id = p_tenant;
END;
$$ LANGUAGE plpgsql;
