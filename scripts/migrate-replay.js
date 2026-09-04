/**
 * Tolerant migration replay — bring-up tool for a FRESH database.
 *
 * WHY THIS EXISTS
 * ---------------
 * The numbered migrations in drizzle/migrations cannot build a database on
 * their own: no migration creates the original baseline tables (0001_sleepy_
 * joseph.sql ALTERs `events_outbox`, which nothing creates). The baseline lives
 * only in src/db/schema/, applied with `drizzle-kit push`.
 *
 * But once push has created the end-state schema, `migrate:all` cannot replay
 * the history either — the early files are not idempotent and die on
 * "relation already exists". migrate-all.ts's own --baseline docs admit this.
 *
 * So a fresh database is stuck: push alone gives tables but NO RLS policies and
 * no migration-seeded reference data; migrate:all alone fails immediately.
 *
 * This script closes that gap. After `drizzle-kit push --force`, it replays
 * every migration statement-by-statement and SKIPS only the errors that mean
 * "push already did this" (duplicate table/column/object) or "this object no
 * longer exists in the current schema" (a table dropped since the migration was
 * written). Anything else is fatal and stops the run.
 *
 * What that leaves you with: schema from the authoritative Drizzle definitions,
 * plus every CREATE POLICY / ENABLE ROW LEVEL SECURITY / INSERT the migrations
 * carry. Verify with `npm run check:rls`, which fails if any tenant_id table
 * lacks a policy — that is the real acceptance test, not this script's output.
 *
 * Ledger rows are written in migrate-all.ts's format (sha256 hex, first 16
 * chars) so a later `npm run migrate:all` sees the files as applied.
 *
 * Usage (inside the app image, with DATABASE_URL set):
 *   node scripts/migrate-replay.js
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Client } = require("pg");

const DIR = path.join(process.cwd(), "drizzle", "migrations");

/** "push already created this" — safe to skip. */
const DUPLICATE = new Set([
  "42P07", // duplicate_table
  "42701", // duplicate_column
  "42710", // duplicate_object (policy, index, constraint)
  "42P06", // duplicate_schema
  "42723", // duplicate_function
  "23505", // unique_violation (re-running a seed INSERT)
]);

/** Object is gone from the current schema — log it, keep going. */
const MISSING = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42704", // undefined_object
  // invalid_text_representation. On a push-built database this means a migration
  // is converting a column type that the current schema no longer has in that
  // form — e.g. 0133 converts content_library.file_size_bytes from text to
  // bigint, but that table was since renamed to content_library_assets and is
  // created directly as bigint. Historical, and safe to skip HERE only because
  // the schema is authoritative and `check:schema` / `check:rls` verify the end
  // state. Never treat this as tolerable in a normal forward migration.
  "22P02",
]);

const checksum = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  await c.query(`CREATE TABLE IF NOT EXISTS _applied_migrations (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const done = new Set(
    (await c.query("SELECT filename FROM _applied_migrations")).rows.map((r) => r.filename)
  );

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const totals = { files: 0, ok: 0, duplicate: 0, missing: 0 };
  const missingLog = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const text = fs.readFileSync(path.join(DIR, file), "utf8");
    const stmts = text
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s));

    for (const stmt of stmts) {
      try {
        await c.query(stmt);
        totals.ok++;
      } catch (e) {
        // Three migrations open an explicit BEGIN. Once a statement errors inside
        // one, Postgres refuses every later command with "current transaction is
        // aborted" until the transaction ends — so clear it before continuing.
        // Harmless no-op (a warning) when no transaction is open.
        await c.query("ROLLBACK").catch(() => {});
        if (DUPLICATE.has(e.code)) {
          totals.duplicate++;
        } else if (MISSING.has(e.code)) {
          totals.missing++;
          missingLog.push(`${file}: [${e.code}] ${e.message}`);
        } else {
          console.error(`\nFATAL in ${file}`);
          console.error(`  [${e.code}] ${e.message}`);
          console.error(`  statement: ${stmt.slice(0, 300).replace(/\s+/g, " ")}`);
          await c.end();
          process.exit(1);
        }
      }
    }

    await c.query(
      "INSERT INTO _applied_migrations (filename, checksum) VALUES ($1,$2) ON CONFLICT (filename) DO NOTHING",
      [file, checksum(text)]
    );
    totals.files++;
  }

  console.log(
    `replayed ${totals.files} migrations — ${totals.ok} statements applied, ` +
      `${totals.duplicate} skipped (already existed), ${totals.missing} skipped (object gone)`
  );
  if (missingLog.length) {
    console.log("\nobjects no longer in the schema (first 15):");
    missingLog.slice(0, 15).forEach((l) => console.log("  " + l));
  }
  await c.end();
})().catch((e) => {
  console.error("REPLAY FAILED:", e.message);
  process.exit(1);
});
