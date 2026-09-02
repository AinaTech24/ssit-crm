import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/automation/outbox/retry-all — re-queue EVERY stuck/errored
 * unprocessed outbox event for the tenant in one go (incident recovery after an
 * outage). Resets last_error + attempts + releases stale claims so the poller
 * re-picks them. Only touches UNPROCESSED, errored rows of the caller's tenant.
 * Gated like the single retry (workflow.edit) + active licence.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const meta = clientMetaFromHeaders(req.headers);

    const count = await withTenant(session.tenantId, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE events_outbox
        SET last_error = NULL, attempts = 0, claimed_at = NULL
        WHERE tenant_id = ${session.tenantId}::uuid
          AND processed_at IS NULL
          AND last_error IS NOT NULL
        RETURNING id
      `);
      const n = res.rows.length;
      if (n > 0) {
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "outbox_event.retry_all",
          entityType: "events_outbox",
          entityId: session.tenantId,
          after: { requeued: n } as any,
          ...meta,
        });
      }
      return n;
    });

    return NextResponse.json({ ok: true, requeued: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
