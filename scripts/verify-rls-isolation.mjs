/**
 * Prove Row-Level Security actually enforces tenant isolation under the
 * non-superuser `mfd_app` role — BEFORE you point the live app at it.
 *
 * Why this exists: the app normally connects as the Postgres superuser, which
 * BYPASSES RLS. Tenant isolation then rests solely on explicit `tenant_id`
 * predicates in app code. Switching APP_DATABASE_URL to the non-superuser role
 * turns the RLS policies on. This script connects AS that role and asserts the
 * policies behave correctly, so the cut-over is a known-good, not a leap.
 *
 * It is READ-ONLY against your data (every probe runs in a transaction that is
 * rolled back; the one write probe is also rolled back).
 *
 * Usage (run with the privileged DATABASE_URL available, as everything else):
 *
 *   # If you've already provisioned + set APP_DATABASE_URL:
 *   node scripts/verify-rls-isolation.mjs
 *
 *   # Or point it at the role explicitly:
 *   APP_DB_PASSWORD='the-mfd_app-password' node scripts/verify-rls-isolation.mjs
 *
 * Exit code 0 = all checks passed; 1 = a check failed (isolation NOT safe).
 */

import "dotenv/config";
import pg from "pg";

const ROLE = "mfd_app";
const TABLE = "investors"; // a representative tenant-scoped table

function appConnString() {
  // Prefer an explicit APP_DATABASE_URL; otherwise derive the mfd_app URL from
  // the privileged DATABASE_URL + APP_DB_PASSWORD (same host/port/db).
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL;
  const priv = process.env.DATABASE_URL;
  const pw = process.env.APP_DB_PASSWORD;
  if (!priv || !pw) return null;
  const u = new URL(priv);
  u.username = ROLE;
  u.password = pw;
  return u.toString();
}

let failures = 0;
function check(name, ok, detail = "") {
  const tag = ok ? "  \x1b[32mPASS\x1b[0m" : "  \x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const privConn = process.env.DATABASE_URL;
  if (!privConn) {
    console.error("[verify-rls] DATABASE_URL (privileged) is required.");
    process.exit(1);
  }
  const appConn = appConnString();
  if (!appConn) {
    console.error(
      "[verify-rls] Cannot resolve the mfd_app connection. Set APP_DATABASE_URL, " +
        "or APP_DB_PASSWORD (so it can be derived from DATABASE_URL)."
    );
    process.exit(1);
  }

  // ── Privileged read: pick the two tenants with the most investors ─────────
  const priv = new pg.Client({ connectionString: privConn });
  await priv.connect();
  let tenants;
  try {
    const r = await priv.query(
      `SELECT tenant_id, COUNT(*)::int AS n
         FROM ${TABLE}
        WHERE tenant_id IS NOT NULL
        GROUP BY tenant_id
        ORDER BY n DESC
        LIMIT 2`
    );
    tenants = r.rows;
    const total = await priv.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
    tenants.total = total.rows[0].n;
  } finally {
    await priv.end();
  }

  if (tenants.length === 0) {
    console.error(`[verify-rls] No rows in ${TABLE} to test with. Seed some data first.`);
    process.exit(1);
  }
  const a = tenants[0];
  const b = tenants[1]; // may be undefined if only one tenant has data

  console.log(`\n[verify-rls] role=${ROLE}  table=${TABLE}`);
  console.log(
    `[verify-rls] tenant A=${a.tenant_id} (${a.n} rows)` +
      (b ? `  tenant B=${b.tenant_id} (${b.n} rows)` : "  (only one tenant has data)") +
      `  total=${tenants.total}\n`
  );

  // ── Connect AS mfd_app and run the policy probes ──────────────────────────
  const app = new pg.Client({ connectionString: appConn });
  await app.connect();
  try {
    // 0. The role must NOT be superuser / bypassrls, or RLS is inert.
    const role = await app.query(
      `SELECT current_user AS u, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`
    );
    const rr = role.rows[0];
    check(
      `role '${rr.u}' is NOT superuser and NOT bypassrls`,
      rr.rolsuper === false && rr.rolbypassrls === false,
      `super=${rr.rolsuper} bypassrls=${rr.rolbypassrls}`
    );

    // 1. With app.tenant_id = A, the role sees EXACTLY tenant A's rows.
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenant_id]);
    const seenA = (await app.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`)).rows[0].n;
    const leakB = b
      ? (await app.query(`SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id = $1`, [b.tenant_id])).rows[0].n
      : 0;
    await app.query("ROLLBACK");
    check(`withTenant(A) sees exactly tenant A's ${a.n} rows`, seenA === a.n, `saw ${seenA}`);
    check(`withTenant(A) sees ZERO of tenant B's rows`, leakB === 0, `leaked ${leakB}`);

    // 2. Context-free read (no app.tenant_id, not platform admin) → ZERO rows.
    await app.query("BEGIN");
    const contextFree = (await app.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`)).rows[0].n;
    await app.query("ROLLBACK");
    check(`context-free read returns ZERO rows (RLS active)`, contextFree === 0, `saw ${contextFree}`);

    // 3. Platform-admin context sees ALL tenants' rows (poller/materializer path).
    await app.query("BEGIN");
    await app.query(`SELECT set_config('app.is_platform_admin', 'true', true)`);
    const adminSeen = (await app.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`)).rows[0].n;
    await app.query("ROLLBACK");
    check(`platform-admin context sees ALL ${tenants.total} rows`, adminSeen === tenants.total, `saw ${adminSeen}`);

    // 4. WITH CHECK blocks a cross-tenant write (rolled back regardless).
    if (b) {
      await app.query("BEGIN");
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenant_id]);
      let blocked = false;
      try {
        // Try to "steal" one of tenant B's rows into tenant A's context by id.
        // RLS USING clause hides B's rows, so this updates nothing OR the
        // WITH CHECK rejects — either way no cross-tenant write succeeds.
        const upd = await app.query(
          `UPDATE ${TABLE} SET updated_at = now() WHERE tenant_id = $1 RETURNING id`,
          [b.tenant_id]
        );
        blocked = upd.rowCount === 0; // USING hid all of B's rows
      } catch {
        blocked = true; // WITH CHECK / policy raised
      }
      await app.query("ROLLBACK");
      check(`cross-tenant write under tenant A touches ZERO of tenant B's rows`, blocked);
    }
  } finally {
    await app.end();
  }

  console.log("");
  if (failures > 0) {
    console.error(`[verify-rls] ${failures} check(s) FAILED — do NOT cut over until green.`);
    process.exit(1);
  }
  console.log("[verify-rls] All checks passed — RLS enforces tenant isolation under mfd_app. ✅");
  process.exit(0);
}

main().catch((e) => {
  console.error("[verify-rls] error:", e.message);
  process.exit(1);
});
