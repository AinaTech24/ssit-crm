/**
 * POST /api/me/session/register — ensure the CURRENT session is tracked as a
 * device.
 *
 * Sessions issued before the device-tracking feature shipped carry no `sid` and
 * have no user_sessions row, so they don't appear under "your devices". This
 * self-heals them: if there's no live row for the session, we mint a fresh sid,
 * record the device row (device name / IP), and re-issue the cookie — no forced
 * re-login. Called on load by the app so every active device registers itself.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { attachSessionCookie } from "@/lib/auth/issue-session";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const s = await requireSession();

    // Already tracked? Just refresh last-seen and return.
    if (s.sid) {
      const has = await withTenant(s.tenantId, async (tx) => {
        const r = await tx.execute(
          sql`SELECT 1 FROM user_sessions WHERE session_id = ${s.sid} AND revoked_at IS NULL LIMIT 1`
        );
        return r.rows.length > 0;
      });
      if (has) {
        await withTenant(s.tenantId, async (tx) => {
          await tx.execute(
            sql`UPDATE user_sessions SET last_seen_at = now() WHERE session_id = ${s.sid} AND revoked_at IS NULL`
          );
        });
        return NextResponse.json({ ok: true, registered: false });
      }
    }

    // Legacy / untracked session → re-issue with a sid + record the device row.
    const res = NextResponse.json({ ok: true, registered: true });
    await attachSessionCookie(res, {
      userId: s.userId,
      tenantId: s.tenantId,
      branchId: s.branchId ?? null,
      roles: s.roles,
      email: s.email,
      name: s.name,
      permissions: s.permissions ?? null,
    });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
