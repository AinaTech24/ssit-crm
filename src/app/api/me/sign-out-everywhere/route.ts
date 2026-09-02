/**
 * POST /api/me/sign-out-everywhere — revoke ALL of the current user's sessions.
 *
 * Stamps users.sessions_invalid_after = now(); every session JWT issued before
 * this instant (including the current one) is rejected on its next request by
 * the session verifier. Self-service security for a role that can see PAN/KYC.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { clearSessionRevocationCache, clearDeviceSessionCache } from "@/lib/auth/revocation";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(users)
        .set({ sessionsInvalidAfter: new Date(), updatedAt: new Date() } as any)
        .where(eq(users.id, session.userId));
      // Revoke every recorded device session so they drop off the "your devices"
      // list and are individually rejected too.
      await tx.execute(
        sql`UPDATE user_sessions SET revoked_at = now(), updated_at = now() WHERE user_id = ${session.userId}::uuid AND revoked_at IS NULL`
      );
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "user.sign_out_everywhere",
        entityType: "user",
        entityId: session.userId,
      });
    });
    // Drop the cached revocation epoch so OTHER devices are kicked on their very
    // next request instead of lingering up to the 2-minute cache TTL. Without
    // this, "sign out of all devices" appeared to only affect the current one.
    clearSessionRevocationCache(session.userId);
    clearDeviceSessionCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
