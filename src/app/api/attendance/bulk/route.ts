import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/attendance/bulk — set the same status on many attendance rows at
 * once (e.g. mark the whole team Holiday on a festival). Managers only.
 *
 * Body: { ids: uuid[], status }
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ATTENDANCE_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  status: z.enum(ATTENDANCE_STATUSES),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => ["owner", "branch_head"].includes(r))) {
      return NextResponse.json({ error: "only a manager can mark attendance" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { ids, status } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const count = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        UPDATE attendance SET status = ${status}, source = 'manual', updated_at = now()
        WHERE tenant_id = ${session.tenantId}::uuid
          AND id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}])
        RETURNING 1
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.bulk_mark",
        entityType: "attendance",
        entityId: session.tenantId,
        after: { status, count: r.rows.length } as any,
        ...clientMeta,
      });
      return r.rows.length;
    });

    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
