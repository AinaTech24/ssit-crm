/**
 * Pre-deploy schema guard.
 *
 * Fails the deploy when the Drizzle ORM schema declares a TABLE or COLUMN that
 * the live database doesn't actually have. That is precisely the drift that
 * 500'd every lead/client page on 2026-07-17: the code carried
 * `tasks.blocked_by_task_id` but its migration never reached prod, so the ORM's
 * SELECT referenced a column Postgres didn't know about.
 *
 * Runs in the deploy AFTER `migrate:all` (see scripts/run-deploy-bluegreen.sh).
 * A genuine gap exits non-zero, which aborts the blue-green cutover — the old
 * colour keeps serving, so a mistake causes ZERO downtime instead of a broken
 * site. It only flags ORM-ahead-of-DB (missing in DB); DB columns the ORM
 * doesn't model are fine and ignored.
 *
 * Read-only: it connects with the app role and reads pg_catalog only.
 */

import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { pool } from "@/db/client";
import * as schema from "@/db/schema";

async function main() {
  // 1. What the ORM expects: table -> set(column db-names), from every pgTable
  //    the schema barrel exports. Enums / relations / views are not PgTable and
  //    are skipped by the `is(..., PgTable)` guard.
  const expected = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    expected.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  }

  // 2. What the DB actually has. pg_catalog (not information_schema) so the
  //    result is independent of column-level grants. Base + partitioned tables
  //    only; system and dropped columns excluded.
  const res = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
  `);
  const actual = new Map<string, Set<string>>();
  for (const row of res.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name)!.add(row.column_name);
  }

  // 3. Diff — collect every ORM object the DB is missing.
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const [table, columns] of expected) {
    const have = actual.get(table);
    if (!have) {
      missingTables.push(table);
      continue;
    }
    for (const col of columns) if (!have.has(col)) missingColumns.push(`${table}.${col}`);
  }

  await pool.end();

  if (missingTables.length || missingColumns.length) {
    console.error("✗ Schema drift — the code expects database objects that don't exist:");
    if (missingTables.length) {
      console.error(`\n  Missing tables (${missingTables.length}):`);
      for (const t of missingTables.sort()) console.error(`    • ${t}`);
    }
    if (missingColumns.length) {
      console.error(`\n  Missing columns (${missingColumns.length}):`);
      for (const c of missingColumns.sort()) console.error(`    • ${c}`);
    }
    console.error(
      "\nThe migration that creates these hasn't been applied. Add/renumber the migration and\n" +
        "deploy it BEFORE (or with) this code. Aborting — the current colour keeps serving.\n"
    );
    process.exit(1);
  }

  console.log(`✓ Schema guard: ${expected.size} ORM tables, every modelled column present in the DB.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Schema guard failed to run:", err?.message ?? err);
  process.exit(1);
});
