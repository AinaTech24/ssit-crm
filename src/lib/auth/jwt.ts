/**
 * Edge-safe JWT primitives.
 *
 * This module contains ONLY the cookie constants, the SessionUser shape, and
 * the jose-based sign/verify helpers — nothing that touches `pg`, `next/headers`,
 * or any Node-only API. That separation is deliberate: `src/middleware.ts` runs
 * in the Edge runtime and imports from HERE, so it must never pull a Postgres
 * client into its bundle (the Edge build fails on node:net/node:tls).
 *
 * The Node-side helpers (getSession / requireSession, and the DB-backed session
 * revocation check) live in `src/lib/auth/session.ts`, which re-exports these so
 * existing `@/lib/auth/session` imports keep working unchanged.
 */

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "mfd_session";
/**
 * Platform-admin (Equitywala) sessions live in a SEPARATE cookie from MFD sessions.
 * This is the fix for the "logging into Equitywala in one tab logs me out of the MFD
 * tab" bug: a single browser shares one cookie jar, so with one cookie name the
 * second login overwrites the first. Two names let an Equitywala-admin session and an
 * MFD session coexist; the URL surface decides which one is read.
 */
export const ADMIN_SESSION_COOKIE = "ssit_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** True for the Equitywala platform-admin URL surface (pages + APIs). */
export function isAdminSurface(pathname: string): boolean {
  return (
    pathname === "/super-admin" ||
    pathname.startsWith("/super-admin/") ||
    pathname.startsWith("/api/super-admin/")
  );
}

/** Which session cookie governs requests to `pathname`. */
export function sessionCookieForPath(pathname: string): string {
  return isAdminSurface(pathname) ? ADMIN_SESSION_COOKIE : SESSION_COOKIE;
}

/** True if these roles belong to Equitywala platform staff. */
export function rolesArePlatformAdmin(roles: string[] | null | undefined): boolean {
  const r = roles ?? [];
  return r.includes("platform_admin") || r.includes("platform_support");
}

/** Which cookie a freshly-issued session for `roles` should be written to. */
export function sessionCookieForRoles(roles: string[] | null | undefined): string {
  return rolesArePlatformAdmin(roles) ? ADMIN_SESSION_COOKIE : SESSION_COOKIE;
}

export type SessionUser = {
  userId: string;
  tenantId: string;
  branchId?: string;
  roles: string[];
  email: string;
  name: string;
  /** Equitywala platform staff. When true, this user bypasses tenant isolation and
   *  is routed to /super-admin instead of /dashboard on login. */
  isPlatformAdmin?: boolean;
  permissions?: string[];
  /** Per-device session id — links this token to a `user_sessions` row so the
   *  device can be listed and logged out individually. Set at issue time. */
  sid?: string;
  /** JWT issued-at (seconds since epoch). Populated by verifySession so the
   *  Node-side revocation check can compare it against users.sessions_invalid_after.
   *  Carried through the middleware `x-mfd-session` header. */
  iat?: number;
};

function secretKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  // Never persist a stale iat from a prior token into a freshly-signed one.
  const { iat: _drop, ...claims } = user;
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/**
 * Two-factor challenge token — issued after the PASSWORD leg succeeds but before
 * the TOTP code is verified. Short-lived (5 min) and purpose-tagged so it can't
 * be replayed as a real session. The /api/auth/2fa/verify route exchanges it +
 * a valid code for a full session cookie.
 */
const TWOFA_CHALLENGE_TTL = "5m";

export async function sign2faChallenge(userId: string): Promise<string> {
  return await new SignJWT({ sub: userId, purpose: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TWOFA_CHALLENGE_TTL)
    .sign(secretKey());
}

export async function verify2faChallenge(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.purpose !== "2fa" || !payload.sub) return null;
    return { userId: String(payload.sub) };
  } catch {
    return null;
  }
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.userId || !payload.tenantId) return null;
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    const permissions = Array.isArray(payload.permissions) ? payload.permissions.map(String) : [];
    return {
      userId: String(payload.userId),
      tenantId: String(payload.tenantId),
      branchId: payload.branchId ? String(payload.branchId) : undefined,
      roles,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      isPlatformAdmin: roles.includes("platform_admin") || roles.includes("platform_support"),
      permissions,
      sid: payload.sid ? String(payload.sid) : undefined,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}
