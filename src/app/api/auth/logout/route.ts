import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { SESSION_COOKIE, ADMIN_SESSION_COOKIE, verifySession } from "@/lib/auth/jwt";
import { withTenant } from "@/db/client";
import { userSessions } from "@/db/schema";
import { clearDeviceSessionCache } from "@/lib/auth/revocation";

/**
 * Clears ONLY the session cookie for the surface you're signing out of, so
 * logging out of the Equitywala console doesn't also kill an MFD session open in
 * another tab (and vice versa).
 *
 *   ?scope=admin  → clear ssit_session
 *   ?scope=mfd    → clear mfd_session
 *   ?scope=all    → clear both
 *   (no scope)    → infer from the Referer; default to the MFD cookie
 *
 * Best-effort: also revokes the corresponding user_sessions row so this device
 * drops off the user's "your devices" list immediately.
 */
async function revokeCookieSession(token?: string): Promise<void> {
  if (!token) return;
  try {
    const s = await verifySession(token);
    if (s?.sid && s.tenantId && s.userId) {
      await withTenant(s.tenantId, async (tx) => {
        await tx
          .update(userSessions)
          .set({ revokedAt: new Date(), updatedAt: new Date() } as any)
          .where(and(eq(userSessions.sessionId, s.sid!), eq(userSessions.userId, s.userId)));
      });
      clearDeviceSessionCache(s.sid);
    }
  } catch {
    /* never block logout on this */
  }
}

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const scope = new URL(req.url).searchParams.get("scope");
  const referer = req.headers.get("referer") ?? "";
  const isAdmin =
    scope === "admin" ||
    (scope == null && /\/super-admin(\/|$|\?)/.test(referer));

  if (scope === "all") {
    await revokeCookieSession(req.cookies.get(SESSION_COOKIE)?.value);
    await revokeCookieSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(ADMIN_SESSION_COOKIE);
  } else {
    const cookieName = isAdmin ? ADMIN_SESSION_COOKIE : SESSION_COOKIE;
    await revokeCookieSession(req.cookies.get(cookieName)?.value);
    res.cookies.delete(cookieName);
  }
  return res;
}
