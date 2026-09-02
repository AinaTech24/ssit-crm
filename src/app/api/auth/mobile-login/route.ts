/**
 * POST /api/auth/mobile-login
 * Body: { email, password }
 *
 * Mobile sibling of /api/auth/login. SAME password + 2FA verification, but the
 * signed session is returned in the RESPONSE BODY (not an httpOnly cookie) so a
 * native app can store it in the device keychain and replay it as
 * `Authorization: Bearer <token>`. React Native has no cookie jar; this is the
 * only auth difference between web and mobile.
 *
 * Responses:
 *   200 { token, user }                — logged in
 *   200 { require2fa: true, challenge } — password ok, exchange at /api/auth/mobile-2fa
 *   401 { error }                       — bad credentials
 *   403 { error }                       — account/tenant inactive
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withSystem } from "@/db/client";
import { sign2faChallenge } from "@/lib/auth/jwt";
import { issueSessionToken } from "@/lib/auth/issue-session";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "email + password required" }, { status: 400 });
  }

  // Rate-limit only FAILED attempts — successful sign-ins never consume budget,
  // so a whole office on one IP is never blocked; only password-guessing is.
  const recordFailure = () => enforce(req, "auth.login", { limit: 15, windowSec: 15 * 60 }, email);

  const userRow = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT u.id, u.tenant_id, u.branch_id, u.email, u.name, u.password_hash, u.roles, u.status, u.permissions, u.two_fa_enabled,
             t.deleted_at AS tenant_deleted_at
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) = ${email}
      ORDER BY (t.deleted_at IS NULL) DESC, u.created_at DESC
      LIMIT 1
    `);
    return (r.rows[0] ?? null) as any;
  });

  if (!userRow || !userRow.password_hash) {
    return recordFailure() ?? NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  if (userRow.status === "suspended" || userRow.status === "offboarded") {
    return NextResponse.json({ error: "account inactive" }, { status: 403 });
  }
  if (userRow.tenant_deleted_at) {
    return NextResponse.json({ error: "account inactive" }, { status: 403 });
  }

  const ok = await bcrypt.compare(password, userRow.password_hash);
  if (!ok) {
    return recordFailure() ?? NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Second factor gate. Password verified, but with 2FA on we hand back a
  // short-lived challenge the app exchanges (+ TOTP/backup code) at
  // /api/auth/mobile-2fa for the real token. No token issued here.
  if (userRow.two_fa_enabled) {
    const challenge = await sign2faChallenge(userRow.id);
    return NextResponse.json({ require2fa: true, challenge });
  }

  withSystem(async (tx) => {
    await tx.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${userRow.id}`);
  }).catch(() => {});

  const token = await issueSessionToken({
    userId: userRow.id,
    tenantId: userRow.tenant_id,
    branchId: userRow.branch_id,
    roles: userRow.roles,
    email: userRow.email,
    name: userRow.name,
    permissions: userRow.permissions,
  });

  return NextResponse.json({
    token,
    user: { id: userRow.id, name: userRow.name, email: userRow.email, roles: userRow.roles },
  });
}
