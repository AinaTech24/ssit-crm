#!/usr/bin/env node
/**
 * CI guard — every base table in `public` that has a `tenant_id` column
 * MUST have row-level security ENABLED + FORCED and a `tenant_isolation`
 * policy. This is the structural backstop behind the multi-tenancy
 * invariant: if a new tenant-scoped table ships without RLS, that's a
 * cross-tenant data leak (exactly the financial_plans hole that migration
 * 0030 closed). This script makes that class of bug fail CI instead of
 * reaching production.
 *
 * What it checks, per tenant_id table:
 *   1. relrowsecurity      — ENABLE ROW LEVEL SECURITY
 *   2. relforcerowsecurity — FORCE ROW LEVEL SECURITY (owner/superuser can't bypass)
 *   3. a policy named `tenant_isolation` exists
 *
 * Exits 0 if all clean, 1 with a per-table breakdown otherwise.
 * Requires DATABASE_URL (loaded from .env via dotenv).
 *
 * Usage:
 *   npm run check:rls
 */

import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[check-rls] DATABASE_URL is not set — cannot verify RLS.");
  process.exit(1);
}

const QUERY = `
  SELECT
    c.table_name                                       AS table_name,
    COALESCE(cls.relrowsecurity, false)                AS rls_enabled,
    COALESCE(cls.relforcerowsecurity, false)           AS rls_forced,
    bool_or(pol.policyname = 'tenant_isolation')       AS has_policy
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema
   AND t.table_name = c.table_name
  JOIN pg_namespace ns ON ns.nspname = c.table_schema
  JOIN pg_class cls
    ON cls.relname = c.table_name
   AND cls.relnamespace = ns.oid
  LEFT JOIN pg_policies pol
    ON pol.tablename = c.table_name
   AND pol.schemaname = c.table_schema
  WHERE c.column_name = 'tenant_id'
    AND c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  GROUP BY c.table_name, cls.relrowsecurity, cls.relforcerowsecurity
  ORDER BY c.table_name;
`;

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });

try {
  const { rows } = await pool.query(QUERY);

  if (rows.length === 0) {
    console.error(
      "[check-rls] found ZERO tables with a tenant_id column — schema not migrated? Refusing to pass."
    );
    process.exit(1);
  }

  const offenders = rows.filter(
    (r) => !r.rls_enabled || !r.rls_forced || !r.has_policy
  );

  if (offenders.length === 0) {
    console.log(
      `[check-rls] ✓ all ${rows.length} tenant-scoped table(s) have RLS enabled + forced + tenant_isolation policy`
    );
    process.exit(0);
  }

  console.error(
    `[check-rls] ✗ ${offenders.length} of ${rows.length} tenant-scoped table(s) are NOT fully protected:\n`
  );
  for (const r of offenders) {
    const missing = [];
    if (!r.rls_enabled) missing.push("RLS not ENABLED");
    if (!r.rls_forced) missing.push("RLS not FORCED");
    if (!r.has_policy) missing.push("no tenant_isolation policy");
    console.error(`  - ${r.table_name}: ${missing.join(", ")}`);
  }
  console.error(
    "\nFix: run `npm run migrate:all` (migration 0030 re-applies the canonical\n" +
      "ENABLE + FORCE + tenant_isolation policy to every tenant_id table), or add a\n" +
      "new migration if this table needs a bespoke policy."
  );
  process.exit(1);
} catch (err) {
  console.error("[check-rls] failed to query database:", err?.message ?? err);
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
