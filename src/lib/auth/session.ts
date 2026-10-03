/**
 * Node-side session helpers. Reads the session JWT from the request and (for
 * authenticated reads) enforces server-side revocation.
 *
 * Cookie name: `mfd_session`
 * Algorithm:   HS256 over the NEXTAUTH_SECRET env var
 * Payload:     { userId, tenantId, branchId?, roles[], email, name, iat, exp }
 * TTL:         8 hours sliding (refreshed on every request via middleware)
 *
 * The Edge-safe sign/verify primitives + the SessionUser shape live in
 * `./jwt` (so `src/middleware.ts` can import them without pulling `pg` into
 * the Edge bundle). This module re-exports them so the ~250 callers of
 * `@/lib/auth/session` keep working unchanged, and adds the Node-only pieces:
 * getSession / requireSession (which run the DB-backed revocation check) plus
 * the dev escape hatch.
 */

import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
  sessionCookieForPath,
  type SessionUser,
} from "./jwt";
import { isSessionRevoked, isDeviceSessionRevoked } from "./revocation";
import { applyViewMode } from "./view-mode";

// Re-export the Edge-safe surface so existing `@/lib/auth/session` imports
// (signSession in the auth routes, verifySession/SESSION_COOKIE, the type) are
// unaffected by the jwt.ts split.
export { SESSION_COOKIE, ADMIN_SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession };
export type { SessionUser };

/**
 * Server-side session read. Use from server components, server actions, API
 * route handlers, and worker code (workers must pass tenantId explicitly —
 * this function will throw because there's no request context).
 *
 * Returns null if no session, OR if the session has been REVOKED
 * (offboarding / forced logout / password reset stamped
 * users.sessions_invalid_after after the token was issued).
 *
 * Caller decides whether null is an error (requireSession turns it into 401).
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  // React.cache() memoizes this for the lifetime of a single server render, so
  // the ~250 callers (layout + page + nested server components) resolve the
  // session ONCE per request instead of re-parsing the header + re-running the
  // revocation check on every call. No behaviour change — the request's session
  // is immutable within the request.
  const session = await readSession();
  if (!session) return null;

  // Revocation gate. Platform-admin sessions live under the platform tenant;
  // the lookup is tenant-scoped and works the same for them. Skipped only when
  // there's no iat (legacy token) — handled inside isSessionRevoked.
  const revoked = await isSessionRevoked({
    userId: session.userId,
    tenantId: session.tenantId,
    iatSeconds: session.iat,
  });
  if (revoked) return null;

  // Per-device revocation ("log out this device") + last-seen touch for presence.
  const deviceRevoked = await isDeviceSessionRevoked({ sid: session.sid, tenantId: session.tenantId });
  if (deviceRevoked) return null;

  // A sub-branch head who has chosen "Switch to admin view" is a firm admin for
  // this request; everyone else comes back unchanged.
  return applyViewMode(session);
});

/**
 * Reads + decodes the session without the revocation check. Prefers the
 * middleware-decoded header (cheap — middleware already verified the JWT),
 * falls back to verifying the cookie directly.
 */
async function readSession(): Promise<SessionUser | null> {
  // Pick the cookie that matches the current surface (admin console vs MFD app)
  // so the fallback reads the same session the middleware resolved. Defaults to
  // the MFD cookie when the path is unknown (e.g. outside request context).
  let cookieName = SESSION_COOKIE;
  try {
    const h = await headers();
    const headerPayload = h.get("x-mfd-session");
    if (headerPayload) {
      return JSON.parse(headerPayload) as SessionUser;
    }
    // Mobile Bearer fallback: routes under a PUBLIC middleware prefix (/api/auth/*)
    // don't get x-mfd-session injected and the app has no cookie jar — so verify
    // the Authorization: Bearer <jwt> here. Same signed session, just a different
    // transport (mirrors the /api/auth/refresh handler).
    const authz = h.get("authorization");
    const bearer = authz?.startsWith("Bearer ") ? authz.slice(7).trim() : null;
    if (bearer) {
      const s = await verifySession(bearer);
      if (s) return s;
    }
    const pathname = h.get("x-pathname");
    if (pathname) cookieName = sessionCookieForPath(pathname);
  } catch {
    // headers() throws outside request context — fall through to cookie path
  }
  try {
    const c = await cookies();
    const token = c.get(cookieName)?.value;
    if (!token) return null;
    return await verifySession(token);
  } catch {
    return null;
  }
}

/**
 * Server-side helper that throws if no session. Use in API routes that
 * absolutely require auth — turns a missing OR revoked session into a clean 401.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (session) return session;

  // A PAGE with no (or a REVOKED) session must land on the login form, not the
  // error boundary. Middleware checks signature + expiry only — Edge cannot
  // reach Postgres — so a revoked-but-unexpired token sails past it and fails
  // here. Throwing turned that into "The app hit a problem" on every dashboard
  // route. The middleware already assumes this redirect happens ("a revoked
  // token gets bounced to /login from there") and even guards the ?next=
  // ping-pong for it; it was simply never implemented.
  //
  // API routes keep the 401 — a JSON caller wants a status, not a redirect.
  let pathname: string | null = null;
  try {
    pathname = (await headers()).get("x-pathname");
  } catch {
    /* outside a request context (worker / test) — fall through to the throw */
  }
  if (pathname && !pathname.startsWith("/api/")) {
    const { redirect } = await import("next/navigation");
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }
  throw new AuthError("not authenticated", 401);
}

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

/**
 * Demo helper: returns a fake session for development when NO_AUTH=1.
 * NEVER use this in production — it bypasses tenant isolation. The guard
 * below makes the function throw rather than return a fake session if it's
 * ever invoked from a production build, so an accidentally-set NO_AUTH env
 * var can't hand any visitor an owner+rm+compliance session.
 */
export function devSession(): SessionUser {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "devSession() called in production — this would bypass tenant isolation"
    );
  }
  // Defaults point at the seeded demo owner (the tenant that holds the demo
  // book) so tenant-scoped reads render populated. Overridable via DEMO_* env
  // vars when the DB is reseeded with fresh ids. Kept in sync with the inline
  // NO_AUTH session in src/middleware.ts.
  return {
    userId: process.env.DEMO_USER_ID ?? "c59fb71f-2bc9-426d-a7b4-8d59cad5481b",
    tenantId: process.env.DEMO_TENANT_ID ?? "3a8231bb-8ff2-4f49-bcca-bb41857c5be2",
    branchId: process.env.DEMO_BRANCH_ID ?? "cfdc80f1-e03f-414f-bab5-460967f524a5",
    roles: ["owner", "rm", "compliance"],
    email: "owner@demo.in",
    name: "Rajesh Demo (Owner)",
  };
}
