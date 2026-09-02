/**
 * DELETE /api/me/devices/[id] — log out one of the current user's devices.
 * Revokes that user_sessions row; the device is rejected on its next request.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { userSessions } from "@/db/schema";
import { clearDeviceSessionCache } from "@/lib/auth/revocation";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const sid = await withTenant(session.tenantId, async (tx) => {
      // Scope to the current user's own sessions — you can only end your own.
      const [row] = await tx
        .select({ sessionId: userSessions.sessionId })
        .from(userSessions)
        .where(and(eq(userSessions.id, id), eq(userSessions.userId, session.userId)))
        .limit(1);
      if (!row) return null;
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(userSessions.id, id), eq(userSessions.userId, session.userId)));
      return row.sessionId;
    });
    if (!sid) return NextResponse.json({ error: "device not found" }, { status: 404 });
    clearDeviceSessionCache(sid); // kick that device on its next request
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
