import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/session/keepalive
 *
 * Rolls the 8h web session forward. The cookie is a fixed-lifetime JWT, so a
 * back-office user who leaves the CRM open all day hit "not authenticated" on
 * the first save after the token aged out (task comments, notes…). The dashboard
 * pings this while the tab is in use so the window slides instead.
 *
 * Safety: the token is verified and run through the SAME revocation checks as
 * getSession — a revoked / offboarded / logged-out session is never re-issued —
 * and the claims are re-signed exactly as they were (no view-mode elevation).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
} from "@/lib/auth/jwt";
import { isDeviceSessionRevoked, isSessionRevoked } from "@/lib/auth/revocation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token) : null;
    if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    if (
      (await isSessionRevoked({ userId: session.userId, tenantId: session.tenantId, iatSeconds: session.iat })) ||
      (await isDeviceSessionRevoked({ sid: session.sid, tenantId: session.tenantId }))
    ) {
      return NextResponse.json({ error: "session revoked" }, { status: 401 });
    }

    const fresh = await signSession({
      userId: session.userId,
      tenantId: session.tenantId,
      branchId: session.branchId,
      roles: session.roles,
      email: session.email,
      name: session.name,
      permissions: session.permissions,
      sid: session.sid,
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, fresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
    return res;
  } catch (err: any) {
    return handleApiError(err);
  }
}
