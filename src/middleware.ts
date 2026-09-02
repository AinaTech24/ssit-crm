/**
 * Edge middleware. Runs on every dashboard + API request.
 *
 * REV: 2025-12 — added /r /d /p public form whitelist for client share-links.
 *
 * Responsibilities:
 *   1. Verify the session JWT once, stash decoded payload on the
 *      `x-mfd-session` header so downstream handlers don't re-verify.
 *   2. Redirect unauthenticated users away from /dashboard.
 *   3. Reject unauthenticated /api/* calls with 401.
 *
 * NOTE: tenant scoping itself happens in `withTenant()` at the DB layer —
 * this middleware just ensures the session exists and is valid. The actual
 * RLS enforcement is in Postgres.
 */

import { NextRequest, NextResponse } from "next/server";
// Import from the Edge-safe primitives module — NOT @/lib/auth/session, which
// pulls in the Node-only DB-backed revocation check (pg) and would break the
// Edge middleware bundle.
import {
  SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  verifySession,
  isAdminSurface,
  sessionCookieForPath,
} from "@/lib/auth/jwt";

export const config = {
  /**
   * Match all paths EXCEPT static assets + Next internals.
   * Excluding more file types here cuts ~30-40 % of middleware invocations
   * on a typical page load (every CSS/font/JS chunk would otherwise trigger
   * JWT verification).
   */
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|css|js|map)).*)",
  ],
};

/**
 * Logged-OUT landing surfaces. A visitor who already holds a session should be
 * sent straight into their app instead of being shown the marketing page (or a
 * login form) — opening crm.ssit.com in a second tab used to render the
 * public landing page even though the user was signed in in the first tab.
 *
 * Deliberately NOT the whole PUBLIC_PATHS set: /terms, /privacy, /refund must
 * stay readable while signed in, and /reset-password + /accept-invite are
 * email-link flows that must work even when another session is present.
 */
const AUTHED_HOME_PATHS = new Set(["/", "/login", "/signup"]);

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  // Public legal pages — must be reachable without a session (Razorpay
  // onboarding + DPDP require publicly-linkable Terms / Privacy / Refund).
  "/terms",
  "/privacy",
  "/refund",
  // Public Knowledge Base hub (the KAIZEN series). Individual articles are
  // covered by the "/knowledge-base/" prefix below. The whole KB is public —
  // scenario, walkthrough and screenshots — with no login anywhere.
  "/knowledge-base",
]);

/**
 * Path prefixes that should never require a session.
 *
 *   /r/*    — public risk-profile questionnaire (client clicks WA/email link)
 *   /lc/*   — public email link click-tracking redirect (campaign emails)
 *   /d/*    — public document-collection form
 *   /p/*    — public proposal-approval page
 *   /lf/*   — public lead-capture form (Sprint 3 #15) — MFD embeds on
 *             their own website; submissions create a new lead
 *   /fd/*   — public Financial Discovery ("Financial Health Check") — client
 *             fills the fact-find before the meeting via a share link
 *   /api/public/*  — submission endpoints for the above
 *   /api/webhooks/* — Vartify / Resend / etc.
 *   /api/health, /api/auth/*, /api/employees/accept-invite — auth flows
 */
const PUBLIC_PATH_PREFIXES = [
  "/r/",
  "/lc/",
  "/d/",
  "/p/",
  "/lf/",
  "/fd/",
  "/portal/",
  "/knowledge-base/",
  // /induction/letter/* — the training confirmation letter. Unauthenticated by
  // design so a member can forward it to a personal inbox; the 32-byte random
  // token IS the authorisation, and the route itself enforces status=passed and
  // a 90-day expiry. Without this it 307'd to /login, which defeats the point.
  "/induction/letter/",
];
const PUBLIC_API_PREFIXES = [
  "/api/public/",
  "/api/portal/",
  // Public landing-page pricing feed — the marketing site polls this so an
  // open tab reflects admin edits live. Only published, display-only copy.
  // Knowledge Base screenshots — the KB is fully public, so these must render
  // for anonymous readers. The route resolves storage keys ONLY from published
  // articles and 302s to a short-lived presigned URL, so the bucket stays private.
  "/api/kb/image/",
  "/api/webhooks/",
  "/api/health",
  "/api/auth/",
  "/api/employees/accept-invite",
  // Caddy on-demand-TLS "ask" endpoint — called by the proxy (no session) to
  // check whether a hostname is a real tenant host before minting a cert.
  "/api/tls/allowed",
  // File reads — the route fail-closes itself (only public asset classes like
  // tenant logos / marketing serve without auth; private docs still require a
  // same-tenant session). Whitelisting lets email clients load the firm logo
  // (no session) instead of being bounced to /login → broken <img>.
  "/api/upload-local/",
];

/**
 * Where an already-signed-in visitor to a logged-out page should land, or null
 * if they hold no session.
 *
 * Signature + expiry only (Edge can't reach Postgres). That's sufficient here
 * because this only ROUTES — it never grants access. The destination still runs
 * the full Node-side revocation check via getSession(), so a revoked token gets
 * bounced to /login from there.
 */
async function signedInDestination(req: NextRequest): Promise<string | null> {
  const mfdToken = req.cookies.get(SESSION_COOKIE)?.value;
  const mfdSession = mfdToken ? await verifySession(mfdToken) : null;
  if (mfdSession) return mfdSession.isPlatformAdmin ? "/super-admin" : "/dashboard";

  const adminToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const adminSession = adminToken ? await verifySession(adminToken) : null;
  if (adminSession?.isPlatformAdmin) return "/super-admin";

  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Correlation id — one per request; surfaced on the response and (via the
  // middleware header-merge) readable by route handlers through headers(), so
  // an error's referenceId can be matched to the exact request that caused it.
  const requestId = crypto.randomUUID();
  // DEV-ONLY CORS for the local browser preview of the mobile app (Expo web
  // build served on a different port calls this API cross-origin). Null — and
  // therefore a complete no-op — in production.
  const devOrigin = process.env.NODE_ENV !== "production" ? req.headers.get("origin") : null;
  const tag = (res: NextResponse) => {
    res.headers.set("x-request-id", requestId);
    if (devOrigin) {
      res.headers.set("Access-Control-Allow-Origin", devOrigin);
      res.headers.set("Access-Control-Allow-Credentials", "true");
      res.headers.set("Vary", "Origin");
    }
    return res;
  };
  if (devOrigin && req.method === "OPTIONS") {
    const pre = new NextResponse(null, { status: 204 });
    pre.headers.set("Access-Control-Allow-Origin", devOrigin);
    pre.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    pre.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    pre.headers.set("Access-Control-Allow-Credentials", "true");
    return pre;
  }

  // Public marketing pages. A signed-in visitor gets routed into their app
  // rather than shown the logged-out landing/login page.
  if (PUBLIC_PATHS.has(pathname)) {
    if (AUTHED_HOME_PATHS.has(pathname)) {
      // A `?next=` on /login means we bounced them here FROM a protected page
      // (e.g. a revoked-but-unexpired token). Redirecting back would ping-pong,
      // so let the login form render in that case.
      const isBounce = pathname === "/login" && req.nextUrl.searchParams.has("next");
      if (!isBounce) {
        const dest = await signedInDestination(req);
        if (dest) return tag(NextResponse.redirect(new URL(dest, req.url)));
      }
    }
    return tag(NextResponse.next());
  }
  // Public form routes — clients click WA/email links without logging in
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return tag(NextResponse.next());
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return tag(NextResponse.next());

  // Dev escape hatch — set NO_AUTH=1 to bypass and inject the demo session.
  // Useful for previewing the UI before a real auth wiring lands.
  // HARD-DISABLED in production builds: an accidentally-set env var would
  // hand any unauthenticated visitor an owner+rm+compliance session.
  if (process.env.NO_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const res = tag(NextResponse.next());
    // Point the demo session at the seeded demo owner (tenant that actually
    // holds the demo book) so every tenant-scoped page renders populated.
    // Overridable via DEMO_* env vars for a reseeded DB with fresh ids.
    res.headers.set(
      "x-mfd-session",
      JSON.stringify({
        userId: process.env.DEMO_USER_ID ?? "c59fb71f-2bc9-426d-a7b4-8d59cad5481b",
        tenantId: process.env.DEMO_TENANT_ID ?? "3a8231bb-8ff2-4f49-bcca-bb41857c5be2",
        branchId: process.env.DEMO_BRANCH_ID ?? "cfdc80f1-e03f-414f-bab5-460967f524a5",
        roles: ["owner", "rm", "compliance"],
        email: "owner@demo.in",
        name: "Rajesh Demo (Owner)",
      })
    );
    return res;
  }

  // Resolve the session from the cookie that governs THIS surface. The admin
  // console (/super-admin, /api/super-admin) reads `ssit_session`; everything
  // else reads `mfd_session`. Two separate cookies = an SSIT-admin login and an
  // MFD login can coexist in the same browser without overwriting each other.
  const onAdminSurface = isAdminSurface(pathname);
  const cookieName = sessionCookieForPath(pathname);
  // Web carries the session in an httpOnly cookie; the mobile app has no cookie
  // jar and sends it as `Authorization: Bearer <token>`. Accept the header as a
  // fallback when the cookie is absent — same signed JWT, so verifySession (and
  // every downstream route reading x-mfd-session) is unchanged. Only the MFD
  // surface uses Bearer; the admin console stays cookie-only.
  let token = req.cookies.get(cookieName)?.value;
  if (!token && !onAdminSurface) {
    const authz = req.headers.get("authorization");
    if (authz?.startsWith("Bearer ")) token = authz.slice(7).trim();
  }
  let session = token ? await verifySession(token) : null;

  // Dual-auth API routes: the shared SSIT content library is READ by MFD users
  // (mfd_session) but WRITTEN by SSIT platform admins (ssit_session). If the
  // path's primary cookie has no valid session, fall back to the other cookie so
  // a platform admin can upload/save — the route handler still does the actual
  // capability check (isPlatformAdmin || template.edit).
  if (!session && pathname.startsWith("/api/content-library")) {
    const altToken = req.cookies.get(
      cookieName === ADMIN_SESSION_COOKIE ? SESSION_COOKIE : ADMIN_SESSION_COOKIE
    )?.value;
    session = altToken ? await verifySession(altToken) : null;
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      const res = tag(NextResponse.json({ error: "not authenticated" }, { status: 401 }));
      // Self-heal: a present-but-invalid/expired token would otherwise be re-sent
      // on every request and keep failing — delete it so the next login is clean
      // (fixes the "had to clear cookies before login worked" symptom).
      if (token) res.cookies.delete(cookieName);
      return res;
    }
    // Nicety: an SSIT admin who lands on an MFD page (no mfd_session) but holds
    // a valid admin session is sent to their console instead of the login page.
    if (!onAdminSurface) {
      const adminToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
      if (adminToken && (await verifySession(adminToken))?.isPlatformAdmin) {
        return tag(NextResponse.redirect(new URL("/super-admin", req.url)));
      }
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    const redirect = tag(NextResponse.redirect(loginUrl));
    // Clear the stale/invalid session cookie on the way to login so it can't keep
    // re-failing (no manual cookie-clearing needed).
    if (token) redirect.cookies.delete(cookieName);
    return redirect;
  }

  // Surface ↔ role consistency. With separate cookies this is mostly defensive,
  // but it keeps a stray/forged token from landing on the wrong console.
  if (onAdminSurface) {
    if (!session.isPlatformAdmin) {
      if (pathname.startsWith("/api/")) {
        return tag(NextResponse.json({ error: "forbidden" }, { status: 403 }));
      }
      return tag(NextResponse.redirect(new URL("/dashboard", req.url)));
    }
  } else if (
    session.isPlatformAdmin &&
    (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))
  ) {
    return tag(NextResponse.redirect(new URL("/super-admin", req.url)));
  }

  // Expose the request pathname to Server Components so they can do path-aware
  // logic (license-restricted carve-out for /dashboard/billing, per-module nav
  // gating). This MUST be set on the REQUEST headers — `headers()` in an RSC
  // reads the incoming request, so a response-only header never reaches it
  // (which silently disabled the restricted-license + nav enforcement).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  const res = tag(NextResponse.next({ request: { headers: requestHeaders } }));
  res.headers.set("x-mfd-session", JSON.stringify(session));
  res.headers.set("x-pathname", pathname);
  return res;
}
