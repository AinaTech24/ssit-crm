import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

// The APP connects with APP_DATABASE_URL when set — a NON-superuser role
// (mfd_app) so Postgres Row-Level Security is actually enforced (a superuser
// bypasses RLS even with FORCE, defeating tenant isolation). Falls back to
// DATABASE_URL, which is also what migrations/seed/scripts use (they need DDL,
// so they run as the privileged role). Setting APP_DATABASE_URL is opt-in:
// nothing changes until it's provided.
const connectionString = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * HMR-safe singleton for the pg pool + drizzle client.
 *
 * Next.js dev mode reloads modules on every file change. Without this guard
 * a NEW Pool is created for every reload, the OLD pool keeps its sockets
 * open, and within a few HMR cycles the Node process is holding hundreds of
 * dangling connections — pool.connect() then waits for the timeout because
 * the OLD pool's slots are stuck.
 *
 * Stashing the pool on globalThis means HMR re-imports the same instance.
 * Only the very first module load creates a new pool; subsequent reloads
 * find it on `globalThis.__mfd_pg_pool` and reuse it.
 */
declare global {
  // eslint-disable-next-line no-var
  var __mfd_pg_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __mfd_db: ReturnType<typeof drizzle<typeof schema>> | undefined;
  // eslint-disable-next-line no-var
  var __mfd_db_role_checked: boolean | undefined;
}

export const pool: Pool =
  globalThis.__mfd_pg_pool ??
  new Pool({
    connectionString,
    // 20 is plenty for a single-tenant dev box. Production scales horizontally
    // via more app replicas, not bigger pools. Raise via PG_POOL_MAX if you
    // legitimately need more (and have the Postgres slots to back it).
    max: Number(process.env.PG_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    // Wait up to 12s for a free slot before failing — 5s was too tight under
    // transient contention (e.g. an RTA import running while the dialog polls
    // status), which surfaced as a 500 "Connection terminated" on upload.
    connectionTimeoutMillis: 12_000,
    // If a connection sits with an open transaction for > 30s, kill it —
    // protects against zombie connections from crashed routes.
    statement_timeout: 30_000,
  });

if (!globalThis.__mfd_pg_pool) {
  globalThis.__mfd_pg_pool = pool;
  // Surface pool errors so a runaway query doesn't silently exhaust the pool.
  pool.on("error", (err) => {
    console.error("[pg pool] idle client error:", err.message);
  });
}

// Disable Drizzle SQL query logging unless explicitly opted-in — in dev it
// adds ~30-100ms per query and floods stdout. Set DB_LOG=1 to re-enable.
export const db: ReturnType<typeof drizzle<typeof schema>> =
  globalThis.__mfd_db ?? drizzle(pool, { schema, logger: process.env.DB_LOG === "1" });

if (!globalThis.__mfd_db) {
  globalThis.__mfd_db = db;
}

export type DbClient = typeof db;

/**
 * SECURITY: assert the app is NOT connected as a superuser / BYPASSRLS role.
 *
 * Postgres superusers (and roles with BYPASSRLS) ignore Row-Level Security
 * entirely — even with FORCE ROW LEVEL SECURITY — so every tenant_isolation
 * policy becomes inert and isolation rests only on explicit `tenant_id`
 * predicates in app code. The app must connect via APP_DATABASE_URL as the
 * non-superuser `mfd_app` role (see `npm run db:provision-app-role`).
 *
 * Runs once, fire-and-forget. In production it hard-fails (exit) on a
 * privileged role so the misconfiguration is loud, not a silent data-leak;
 * in dev it warns. Override (NOT recommended) with ALLOW_SUPERUSER_DB=1.
 */
async function assertNonBypassingRole(): Promise<void> {
  try {
    const res = await pool.query(
      `SELECT current_user AS role, r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`
    );
    const row = res.rows[0] as { role: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
    if (!row || (!row.rolsuper && !row.rolbypassrls)) return; // safe role
    if (process.env.ALLOW_SUPERUSER_DB === "1") return; // explicit override

    const why = row.rolsuper ? "is a SUPERUSER" : "has BYPASSRLS";
    const msg =
      `[db] SECURITY: connected as '${row.role}' which ${why} — Row-Level Security is NOT enforced; ` +
      `tenant isolation relies solely on explicit predicates. Provision + use the non-superuser role: ` +
      `\`npm run db:provision-app-role\` then set APP_DATABASE_URL=postgres://mfd_app:<pw>@host/db.`;

    // `next build` runs with NODE_ENV=production and imports route modules to
    // collect page data — but it is NOT serving traffic, so the hard-exit must
    // NOT fire there or it kills the build worker (mis-reported as a confusing
    // "Cannot find module for page" error). Only refuse at actual server start.
    const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
    if (process.env.NODE_ENV === "production" && !isBuildPhase) {
      console.error(msg + " Refusing to start in production (set ALLOW_SUPERUSER_DB=1 to override).");
      process.exit(1);
    } else {
      console.warn(msg);
    }
  } catch {
    // Never let the safety check itself break startup.
  }
}

if (!globalThis.__mfd_db_role_checked) {
  globalThis.__mfd_db_role_checked = true;
  void assertNonBypassingRole();
}

/**
 * Run `fn` inside a transaction with the tenant_id (and optional user/branch)
 * set as Postgres session variables. Every RLS policy reads
 * `current_setting('app.tenant_id')` to scope rows.
 *
 * Use this from API routes, server actions, and worker jobs. Never call
 * `db.transaction(...)` directly outside a system-context (admin) path —
 * RLS will block your queries with NO informative error.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  opts?: { userId?: string; branchId?: string; roles?: string[] }
): Promise<T> {
  return db.transaction(async (tx) => {
    // Parameterized set_config (transaction-LOCAL). MUST use a drizzle `sql`
    // object — a raw string passed to tx.execute() is NOT reliably executed
    // under the bundled runtime, which silently leaves the RLS context unset.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    if (opts?.userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${opts.userId}, true)`);
    }
    if (opts?.branchId) {
      await tx.execute(sql`SELECT set_config('app.branch_id', ${opts.branchId}, true)`);
    }
    if (opts?.roles?.length) {
      await tx.execute(sql`SELECT set_config('app.roles', ${opts.roles.join(",")}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Platform admin transaction — sets `app.is_platform_admin = true` so RLS
 * policies grant cross-tenant access. Used by SSIT super admins to manage
 * all MFD tenants from the /super-admin section.
 *
 * adminUserId is the SSIT staff user id; recorded in audit_log for every
 * cross-tenant write.
 */
export async function withPlatformAdmin<T>(
  adminUserId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'true', true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${adminUserId}, true)`);
    return fn(tx);
  });
}

/**
 * System-level transaction that bypasses RLS — only for cross-tenant maintenance,
 * background reconciliation, and admin tooling. Guarded by env flag.
 */
export async function withSystem<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  if (process.env.ALLOW_SYSTEM_TX !== "1") {
    throw new Error("withSystem disabled — set ALLOW_SYSTEM_TX=1 to enable");
  }
  return db.transaction(async (tx) => {
    // Grant cross-tenant access for this transaction via the platform-admin
    // branch of every RLS policy (works whether or not the connecting role is
    // a superuser).
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'true', true)`);
    return fn(tx);
  });
}

// Prevent SQL injection via tenant id (uuid only, but defense in depth).
function escape(v: string): string {
  if (!/^[0-9a-zA-Z_,\-]+$/.test(v)) {
    throw new Error(`Invalid session value: ${v}`);
  }
  return v;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
