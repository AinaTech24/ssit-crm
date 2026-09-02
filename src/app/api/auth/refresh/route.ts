import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/refresh
 *
 * Re-signs a fresh session token for a mobile client carrying a Bearer token
 * (mobile has no sliding-cookie refresh, so its token would otherwise expire
 * mid-use). The app calls this on launch / before expiry to roll the 8h window.
 *
 * IMPORTANT: this route lives under the PUBLIC `/api/auth/*` middleware prefix
 * (so login/forgot work without a session), which means the middleware does NOT
 * inject the decoded Bearer session here. So we verify the Authorization Bearer
 * token OURSELVES and run the DB revocation check — a refreshed token can't
 * outlive an offboard or a forced logout.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/jwt";
import { isSessionRevoked } from "@/lib/auth/revocation";
import { issueSessionToken } from "@/lib/auth/issue-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authz = req.headers.get("authorization");
    const bearer = authz?.startsWith("Bearer ") ? authz.slice(7).trim() : null;
    const session = bearer ? await verifySession(bearer) : null;
    if (!session) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const revoked = await isSessionRevoked({
      userId: session.userId,
      tenantId: session.tenantId,
      iatSeconds: session.iat,
    });
    if (revoked) {
      return NextResponse.json({ error: "session revoked" }, { status: 401 });
    }

    const token = await issueSessionToken({
      userId: session.userId,
      tenantId: session.tenantId,
      branchId: session.branchId,
      roles: session.roles,
      email: session.email,
      name: session.name,
      permissions: session.permissions,
    });
    return NextResponse.json({ token });
  } catch (err: any) {
    return handleApiError(err);
  }
}
