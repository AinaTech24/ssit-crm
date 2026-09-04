/**
 * DESTRUCTIVE: clears every table and enum in the `public` schema.
 *
 * Purpose: let `migrate:all` build the schema from the numbered migrations in
 * order, on a database where `db:push` had already created the final tables.
 * Those two approaches conflict — push creates the end-state, then the historical
 * migrations try to CREATE TABLE the same objects and fail.
 *
 * ONLY run this on a database with no business data. It is a bring-up tool, not
 * an operations tool. There is no confirmation prompt and no undo.
 *
 *   docker run --rm --env-file .env.production \
 *     -v ~/app/certs:/app/certs -v /tmp/reset.js:/app/reset.js \
 *     mfd-app:latest node /app/reset.js
 */
const { Client } = require("pg");

const COUNT = "select count(*)::int n from pg_tables where schemaname='public'";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const before = (await c.query(COUNT)).rows[0].n;
  if (before === 0) {
    console.log("schema already empty — nothing to do");
    await c.end();
    return;
  }

  await c.query(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
      EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
    FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname='public' AND t.typtype='e' LOOP
      EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
    END LOOP;
  END $$;`);

  const after = (await c.query(COUNT)).rows[0].n;
  console.log(`tables: ${before} -> ${after}`);
  if (after !== 0) {
    console.error("WARNING: some tables survived — inspect before migrating");
    process.exitCode = 1;
  }
  await c.end();
})().catch((e) => {
  console.error("RESET FAILED:", e.message);
  process.exit(1);
});
