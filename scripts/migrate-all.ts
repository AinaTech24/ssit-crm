/**
 * migrate:all — the single source of truth for applying the hand-written
 * SQL migrations under drizzle/migrations/*.sql.
 *
 * Why this exists: the repo accumulated ~30 numbered SQL files (RLS,
 * perf indexes, every feature table since 0001) that were applied
 * one-by-one via scripts/apply-migration.ts with NO record of what ran.
 * A fresh DB rebuild had no way to know the correct order or what was
 * already applied. This runner fixes that:
 *
 *   1. Ensures a `_applied_migrations` ledger table exists.
 *   2. Lists drizzle/migrations/*.sql sorted by filename (zero-padded
 *      numeric prefix → lexicographic == chronological).
 *   3. Applies each file NOT already in the ledger, inside its own
 *      transaction, then records { filename, checksum, applied_at }.
 *   4. If a file's checksum changed after it was applied, it WARNS (we
 *      never silently re-run — edit-after-apply is a mistake to surface).
 *
 * Idempotent: re-running applies only new files. Safe in CI + prod.
 *
 * Usage:
 *   npm run migrate:all                apply all pending
 *   npm run migrate:all -- --dry       list pending without applying
 *   npm run migrate:all -- --baseline  record pending files as applied WITHOUT
 *                                      running them — for adopting the ledger
 *                                      on a DB that was already migrated the
 *                                      old one-by-one way. Apply any genuinely
 *                                      new files first, then baseline.
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

// This runner applies schema/RLS migrations cross-tenant, so it legitimately
// needs system (RLS-bypassing) DB access. withSystem() is gated by this flag;
// default it on for the migrator unless the operator explicitly disabled it.
// (Read at call-time inside withSystem, so setting it here is sufficient.)
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

// NOTE: db/client.ts is imported DYNAMICALLY inside main() (not here), because
// it picks its connection string at module-load time and prefers
// APP_DATABASE_URL — the restricted runtime role that lacks DDL. Migrations
// need DDL, so we force the privileged DATABASE_URL first, then import.

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");
const DRY = process.argv.includes("--dry");
/**
 * --baseline: adopt the ledger on a DB that is ALREADY migrated. Records every
 * on-disk migration as applied WITHOUT executing it. Use this exactly once when
 * introducing the ledger on an existing database (ours already had 0001-00xx
 * applied the old one-by-one way, and several early files aren't idempotent so
 * re-running them would error). After baselining, plain `migrate:all` applies
 * only genuinely-new files.
 */
const BASELINE = process.argv.includes("--baseline");

function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function main() {
  // Migrations need DDL — always connect as the privileged role (DATABASE_URL),
  // even when APP_DATABASE_URL (the restricted runtime role) is also set. Point
  // the shared client at the master URL BEFORE importing it (it reads the
  // connection string at module load).
  if (process.env.DATABASE_URL) process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
  const { withSystem } = await import("../src/db/client");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // zero-padded numeric prefixes sort chronologically

  await withSystem(async (tx) => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS _applied_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  const appliedRows = await withSystem(async (tx) =>
    (
      await tx.execute(sql`SELECT filename, checksum FROM _applied_migrations`)
    ).rows as Array<{ filename: string; checksum: string }>
  );
  const applied = new Map(appliedRows.map((r) => [r.filename, r.checksum]));

  const pending: string[] = [];
  const drifted: string[] = [];
  for (const f of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const cs = checksum(text);
    if (!applied.has(f)) {
      pending.push(f);
    } else if (applied.get(f) !== cs) {
      drifted.push(f);
    }
  }

  if (drifted.length) {
    console.warn(
      `[migrate] ⚠ ${drifted.length} already-applied file(s) changed on disk (NOT re-run):`
    );
    for (const f of drifted) console.warn(`    ~ ${f}`);
    console.warn(
      "    If a change is intentional, add a NEW migration instead of editing an applied one."
    );
  }

  if (pending.length === 0) {
    console.log("[migrate] up to date — nothing to apply.");
    process.exit(0);
  }

  // --baseline: record pending files as applied WITHOUT running them. For
  // adopting the ledger on an already-migrated DB. (Apply any genuinely-new
  // files the normal way FIRST, then baseline — never baseline a file whose
  // SQL hasn't actually run against this database.)
  if (BASELINE) {
    console.log(`[migrate] --baseline: recording ${pending.length} file(s) as applied WITHOUT executing:`);
    for (const f of pending) {
      const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      const cs = checksum(text);
      await withSystem(async (tx) => {
        await tx.execute(sql`
          INSERT INTO _applied_migrations (filename, checksum)
          VALUES (${f}, ${cs})
          ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()
        `);
      });
      console.log(`    = ${f}`);
    }
    console.log(`[migrate] baseline complete — ledger now tracks ${pending.length} file(s).`);
    process.exit(0);
  }

  console.log(`[migrate] ${pending.length} pending:`);
  for (const f of pending) console.log(`    + ${f}`);

  if (DRY) {
    console.log("[migrate] --dry: not applying.");
    process.exit(0);
  }

  for (const f of pending) {
    const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const cs = checksum(text);
    process.stdout.write(`[migrate] applying ${f} … `);
    try {
      await withSystem(async (tx) => {
        await tx.execute(sql.raw(text));
        await tx.execute(sql`
          INSERT INTO _applied_migrations (filename, checksum)
          VALUES (${f}, ${cs})
          ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()
        `);
      });
      console.log("ok");
    } catch (err: any) {
      console.log("FAILED");
      console.error(err?.message ?? err);
      process.exit(1);
    }
  }
  console.log(`[migrate] done — applied ${pending.length} migration(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] fatal:", err?.message ?? err);
  process.exit(1);
});
