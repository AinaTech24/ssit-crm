/**
 * Provision the non-superuser application role `mfd_app` so Row-Level Security
 * is actually ENFORCED at runtime.
 *
 * The app currently connects as the Postgres superuser (DATABASE_URL), which
 * BYPASSES RLS — making tenant isolation depend solely on explicit predicates.
 * This script creates a dedicated NOSUPERUSER / NOBYPASSRLS role with exactly
 * the DML privileges the app needs, so pointing APP_DATABASE_URL at it turns on
 * every tenant_isolation policy. Migrations/seed/backfills keep using the
 * privileged DATABASE_URL (they need DDL).
 *
 * Idempotent. Run as the privileged role:
 *   APP_DB_PASSWORD='a-strong-password' node scripts/provision-app-role.mjs
 *
 * Then set (do NOT commit) e.g.:
 *   APP_DATABASE_URL=postgres://mfd_app:a-strong-password@localhost:5432/mfd
 */

import "dotenv/config";
import pg from "pg";

const ROLE = "mfd_app";

async function main() {
  const pw = process.env.APP_DB_PASSWORD;
  if (!pw || pw.length < 8) {
    console.error("[provision] set APP_DB_PASSWORD to a strong (>=8 char) password first.");
    process.exit(1);
  }
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error("[provision] DATABASE_URL (privileged) is required.");
    process.exit(1);
  }
  const dbName = new URL(conn).pathname.replace(/^\//, "") || "postgres";
  const pwLit = `'${pw.replace(/'/g, "''")}'`; // escaped single-quoted literal

  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    // Create or update the role (idempotent).
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          ALTER ROLE ${ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pwLit};
        ELSE
          CREATE ROLE ${ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pwLit};
        END IF;
      END $$;
    `);

    // Least-privilege DML grants (no DDL — migrations own schema changes).
    await client.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${ROLE};`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE};`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ROLE};`);
    // Future objects created by migrations are auto-granted.
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE};`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${ROLE};`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${ROLE};`);

    const check = await client.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${ROLE}'`
    );
    const r = check.rows[0];
    console.log(`[provision] role '${ROLE}' ready — superuser=${r.rolsuper} bypassrls=${r.rolbypassrls}`);
    console.log(`[provision] now set (do NOT commit):`);
    console.log(`  APP_DATABASE_URL=postgres://${ROLE}:<password>@<host>:<port>/${dbName}`);
  } finally {
    await client.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[provision] failed:", e.message);
  process.exit(1);
});
