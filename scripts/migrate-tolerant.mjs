/**
 * Tolerant migrator for a FRESH database whose schema was created from the
 * current Drizzle schema (via `drizzle-kit export` / `db:push`).
 *
 * The hand-written numbered migrations are the *historical* record of how the
 * schema was built (drizzle-generate snapshots + RLS, applied one-by-one). On a
 * fresh DB that already has the CURRENT schema, replaying them whole conflicts:
 * a `CREATE INDEX`/`CREATE TABLE` for an object the export already made errors,
 * and (because each file ran in one transaction) rolls back the RLS in the same
 * file. RLS policies live ONLY in these migrations, not in the Drizzle schema,
 * so they MUST be applied.
 *
 * This runner applies each migration STATEMENT-BY-STATEMENT and skips
 * "already exists" duplicates, so the additive bits (RLS policies, new columns,
 * constraints) land while duplicate creates become no-ops. It records each file
 * in the same `_applied_migrations` ledger `migrate:all` uses, so subsequent
 * normal `migrate:all` runs only apply genuinely-new files.
 *
 *   node scripts/migrate-tolerant.mjs
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const DIR = join(process.cwd(), "drizzle", "migrations");
const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error("[migrate] DATABASE_URL (privileged) is required.");
  process.exit(1);
}

// Postgres "already exists" / duplicate-object SQLSTATEs — safe to skip when the
// object was already created by the schema export.
const DUP_CODES = new Set([
  "42P07", // duplicate_table (also index/view/sequence)
  "42710", // duplicate_object (policy, type, trigger…)
  "42P06", // duplicate_schema
  "42701", // duplicate_column
  "42723", // duplicate_function
  "42P04", // duplicate_database
  "42P05", // duplicate_prepared_statement
  "42P11", // invalid_cursor_definition (unused, harmless)
]);
function isAlreadyExists(e) {
  if (e && e.code && DUP_CODES.has(e.code)) return true;
  const m = ((e && e.message) || "").toLowerCase();
  return m.includes("already exists");
}

/**
 * Split SQL into top-level statements on `;`, respecting line/block comments,
 * single-quoted strings, and dollar-quoted ($tag$…$tag$) blocks. Drizzle's
 * `--> statement-breakpoint` markers are line comments and fall out naturally.
 */
function splitStatements(sqlText) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sqlText.length;
  let inLine = false,
    inBlock = false,
    inStr = false,
    dollar = null;
  while (i < n) {
    const c = sqlText[i];
    const c2 = sqlText[i + 1];
    if (inLine) {
      cur += c;
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      cur += c;
      if (c === "*" && c2 === "/") {
        cur += c2;
        i += 2;
        inBlock = false;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (c2 === "'") {
          cur += c2;
          i += 2;
          continue;
        }
        inStr = false;
      }
      i++;
      continue;
    }
    if (dollar) {
      if (sqlText.startsWith(dollar, i)) {
        cur += dollar;
        i += dollar.length;
        dollar = null;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === "-" && c2 === "-") {
      inLine = true;
      cur += c;
      i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      inBlock = true;
      cur += c;
      i++;
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      i++;
      continue;
    }
    if (c === "$") {
      const m = sqlText.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        dollar = m[0];
        cur += dollar;
        i += dollar.length;
        continue;
      }
    }
    if (c === ";") {
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  // Drop empties + comment-only chunks.
  return out.filter((s) => {
    const stripped = s
      .replace(/--[^\n]*(\n|$)/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    return stripped.length > 0;
  });
}

const csum = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16);

async function main() {
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS _applied_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  const applied = new Set(
    (await client.query(`SELECT filename FROM _applied_migrations`)).rows.map((r) => r.filename)
  );
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  let totalSkips = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const text = readFileSync(join(DIR, f), "utf8");
    const stmts = splitStatements(text);
    process.stdout.write(`[migrate] ${f} (${stmts.length} stmts) … `);
    let fileSkips = 0;
    for (const stmt of stmts) {
      try {
        await client.query(stmt);
      } catch (e) {
        if (isAlreadyExists(e)) {
          fileSkips++;
          totalSkips++;
          continue;
        }
        console.log("FAILED");
        console.error(`  stmt: ${stmt.slice(0, 160).replace(/\s+/g, " ")}`);
        console.error(`  error: ${e.code || ""} ${e.message}`);
        await client.end();
        process.exit(1);
      }
    }
    await client.query(
      `INSERT INTO _applied_migrations (filename, checksum) VALUES ($1,$2)
       ON CONFLICT (filename) DO UPDATE SET checksum=EXCLUDED.checksum, applied_at=now()`,
      [f, csum(text)]
    );
    console.log(`ok${fileSkips ? ` (${fileSkips} dup skipped)` : ""}`);
    appliedCount++;
  }
  console.log(`[migrate] done — ${appliedCount} file(s) applied, ${totalSkips} duplicate stmt(s) skipped.`);
  await client.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("[migrate] fatal:", e?.message ?? e);
  process.exit(1);
});
