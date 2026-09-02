/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Verifies the bcrypt-hashed password against the users table, signs a JWT,
 * and sets the httpOnly session cookie. The cookie is the credential —
 * never returned in the response body.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withSystem } from "@/db/client";
import { sign2faChallenge } from "@/lib/auth/jwt";
import { attachSessionCookie } from "@/lib/auth/issue-session";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "email + password required" }, { status: 400 });
  }

  // We rate-limit only FAILED attempts (below). Successful sign-ins never
  // consume the budget, so normal use — even repeated clicks or many staff on
  // one office IP — is never blocked; only password-guessing is.
  const recordFailure = () => enforce(req, "auth.login", { limit: 15, windowSec: 15 * 60 }, email);

  const userRow = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT u.id, u.tenant_id, u.branch_id, u.email, u.name, u.password_hash, u.roles, u.status, u.permissions, u.two_fa_enabled,
             u.deleted_at AS user_deleted_at,
             t.deleted_at AS tenant_deleted_at
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) = ${email}
      -- Prefer a user whose tenant is live (not soft-deleted), then the newest,
      -- so a leftover deleted-tenant user never shadows a freshly re-created one.
      ORDER BY (t.deleted_at IS NULL) DESC, u.created_at DESC
      LIMIT 1
    `);
    return (r.rows[0] ?? null) as any;
  });

  if (!userRow || !userRow.password_hash) {
    // Generic message — don't leak which leg failed.
    return recordFailure() ?? NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  if (userRow.status === "suspended" || userRow.status === "offboarded") {
    return NextResponse.json({ error: "account inactive" }, { status: 403 });
  }
  // A trashed (soft-deleted) employee can't sign in until an admin restores them.
  if (userRow.user_deleted_at) {
    return NextResponse.json({ error: "account inactive" }, { status: 403 });
  }
  // A soft-deleted tenant's users can't sign in (the tenant was removed by SSIT).
  if (userRow.tenant_deleted_at) {
    return NextResponse.json({ error: "account inactive" }, { status: 403 });
  }

  const ok = await bcrypt.compare(password, userRow.password_hash);
  if (!ok) {
    return recordFailure() ?? NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Second factor gate. Password is verified, but if 2FA is on we do NOT issue
  // a session yet — instead hand back a short-lived challenge the client
  // exchanges (with a TOTP / backup code) at /api/auth/2fa/verify. No cookie is
  // set here, so a stolen password alone never yields an authenticated session.
  if (userRow.two_fa_enabled) {
    const challenge = await sign2faChallenge(userRow.id);
    return NextResponse.json({ require2fa: true, challenge });
  }

  // Update last_login_at — fire-and-forget, don't block on it.
  withSystem(async (tx) => {
    await tx.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${userRow.id}`);
  }).catch(() => {});

  const res = NextResponse.json({ ok: true, user: { id: userRow.id, name: userRow.name, email: userRow.email, roles: userRow.roles } });
  return attachSessionCookie(res, {
    userId: userRow.id,
    tenantId: userRow.tenant_id,
    branchId: userRow.branch_id,
    roles: userRow.roles,
    email: userRow.email,
    name: userRow.name,
    permissions: userRow.permissions,
  });
}
