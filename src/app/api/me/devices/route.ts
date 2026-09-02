/**
 * GET /api/me/devices — the current user's active login sessions (devices),
 * newest-active first, with the current device flagged.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { userSessions } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({
          id: userSessions.id,
          sessionId: userSessions.sessionId,
          deviceName: userSessions.deviceName,
          ipAddress: userSessions.ipAddress,
          lastSeenAt: userSessions.lastSeenAt,
          createdAt: userSessions.createdAt,
        })
        .from(userSessions)
        .where(and(eq(userSessions.userId, session.userId), isNull(userSessions.revokedAt)))
        .orderBy(desc(userSessions.lastSeenAt))
        .limit(100)
    );
    const devices = rows.map(({ sessionId, ...r }) => ({
      ...r,
      current: sessionId === session.sid, // never expose the raw sid
    }));
    return NextResponse.json({ devices });
  } catch (err) {
    return handleApiError(err);
  }
}
