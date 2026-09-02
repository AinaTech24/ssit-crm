/**
 * Shared session-cookie issuance. Used by the password login route AND the
 * 2FA verify route so the cookie shape never drifts between the two entry
 * points into a logged-in session.
 *
 * Each issued session also records a `user_sessions` row (keyed by the JWT's
 * `sid`) so the user can see + individually log out their devices, and so
 * presence (last-seen) works. That recording is best-effort — a DB hiccup must
 * never block login.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { signSession, sessionCookieForRoles, SESSION_TTL_SECONDS } from "./jwt";
import { withTenant } from "@/db/client";
import { userSessions } from "@/db/schema";

export type SessionUserInput = {
  userId: string;
  tenantId: string;
  branchId?: string | null;
  roles: string[] | null;
  email: string;
  name: string;
  permissions?: string[] | null;
};

/** Best-effort human device label from a user-agent string. */
function deviceNameFromUA(ua: string): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Browser";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "device";
  return `${browser} on ${os}`;
}

/** Record a login as a device session. Never throws — login must not depend on it. */
async function recordSession(sid: string, user: SessionUserInput): Promise<void> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
    await withTenant(user.tenantId, async (tx) => {
      await tx.insert(userSessions).values({
        tenantId: user.tenantId,
        userId: user.userId,
        sessionId: sid,
        deviceName: deviceNameFromUA(ua),
        userAgent: ua.slice(0, 500),
        ipAddress: ip,
      } as any);
    });
  } catch {
    /* fail-open */
  }
}

/**
 * Sign a session JWT for `user` and return the raw token string.
 *
 * This is the credential the MOBILE app carries (in its keychain), sent as
 * `Authorization: Bearer <token>` on every API call. The web app uses the
 * httpOnly cookie instead (see attachSessionCookie) — same signed payload,
 * different transport. Keeping both paths on this one signer means the session
 * shape never drifts between web and mobile.
 */
export async function issueSessionToken(user: SessionUserInput): Promise<string> {
  const sid = crypto.randomUUID();
  const token = await signSession({
    userId: user.userId,
    tenantId: user.tenantId,
    branchId: user.branchId ?? undefined,
    roles: user.roles ?? [],
    email: user.email,
    name: user.name,
    permissions: user.permissions ?? [],
    sid,
  });
  await recordSession(sid, user);
  return token;
}

/** Sign a session JWT for `user` and attach it as the httpOnly cookie on `res`. */
export async function attachSessionCookie(
  res: NextResponse,
  user: SessionUserInput
): Promise<NextResponse> {
  const token = await issueSessionToken(user);
  // Platform-admin sessions go to a separate cookie so they don't clobber an
  // MFD session in the same browser (and vice versa).
  res.cookies.set(sessionCookieForRoles(user.roles), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
