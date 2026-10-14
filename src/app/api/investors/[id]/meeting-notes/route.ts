import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/meeting-notes
 *
 * The notes taken in this client's meetings, newest meeting first — for the
 * Engagement tab, so what was discussed and decided sits beside the calls,
 * emails and notes instead of one click away on each meeting.
 *
 * Read-only: notes are written on the meeting itself, where the outcome and
 * action items live. Visibility follows the CLIENT wall, like the other
 * Engagement sections.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, rmId: investors.rmId, serviceRmId: investors.serviceRmId, branchId: investors.branchId })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) throw Object.assign(new Error("client not found"), { status: 404 });
      await assertCanViewClient(tx, session, inv);

      const r = await tx.execute(sql`
        SELECT m.id, m.meeting_date, m.status, m.meeting_type, m.subject,
               m.discussion_points, m.meeting_notes,
               COALESCE(cu.name, ru.name) AS owner_name
        FROM review_meetings m
        LEFT JOIN users cu ON cu.id = m.created_by_id
        LEFT JOIN users ru ON ru.id = m.rm_id
        WHERE m.tenant_id = ${session.tenantId}::uuid
          AND m.investor_id = ${id}::uuid
          AND (COALESCE(btrim(m.meeting_notes), '') <> '' OR COALESCE(btrim(m.discussion_points), '') <> '')
        ORDER BY m.meeting_date DESC
        LIMIT 100
      `);
      return r.rows;
    });
    return NextResponse.json({ meetings: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}
