import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/automation/outbox/[id]/retry — clear the error on a stuck
 * unprocessed outbox event so the poller re-picks it.
 *
 * Resets last_error + attempts and releases any stale claim (claimed_at=NULL).
 * Only touches UNPROCESSED rows of the caller's tenant. Gated like other
 * automation mutations (workflow.edit) + active licence.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE events_outbox
        SET last_error = NULL, attempts = 0, claimed_at = NULL
        WHERE id = ${id}::bigint
          AND tenant_id = ${session.tenantId}::uuid
          AND processed_at IS NULL
        RETURNING id
      `);
      if (!res.rows.length) return false;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "outbox_event.retry",
        entityType: "events_outbox",
        entityId: id,
        after: { requeued: true } as any,
        ...meta,
      });
      return true;
    });

    if (!out) return NextResponse.json({ error: "event not found or already processed" }, { status: 409 });
    return NextResponse.json({ ok: true, requeued: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
