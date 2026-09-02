/**
 * GET /api/presence — who on the current firm's team is online right now.
 *
 * "Online" = has a non-revoked device session whose last_seen_at is within the
 * last 5 minutes (the session heartbeat throttles at ~1 min). Returns the online
 * user ids + count for live active/inactive indicators.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const ids = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT DISTINCT user_id FROM user_sessions
        WHERE tenant_id = ${session.tenantId}::uuid
          AND revoked_at IS NULL
          AND last_seen_at > now() - interval '5 minutes'
      `);
      return (r.rows as Array<{ user_id: string }>).map((x) => x.user_id);
    });
    return NextResponse.json({ online: ids, count: ids.length });
  } catch (err) {
    return handleApiError(err);
  }
}
