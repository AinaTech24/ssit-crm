import { handleApiError } from "@/lib/api/error-handler";
/**
 * Call log on a client.
 *
 *   GET  /api/investors/[id]/calls  — every logged call on this client, newest first
 *   POST /api/investors/[id]/calls  — log one
 *
 * Stored as `activities` rows with kind='call' — the unified interaction log
 * already models a phone call (direction, outcome, duration, next follow-up), so
 * a call logged here also shows up in Activity Log, rather than living in a
 * parallel table nobody else reads.
 *
 * Visibility follows the CLIENT wall, exactly like Notes: a servicing RM has to
 * see the calls the relationship RM made, or each person is shown a different
 * client history. (/api/activities scopes to rows you own, which is right for
 * "my work" and wrong for a shared client.)
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activities, investors, ACTIVITY_DIRECTIONS, ACTIVITY_STATUSES } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  direction: z.enum(ACTIVITY_DIRECTIONS).default("outbound"),
  status: z.enum(ACTIVITY_STATUSES).default("answered"),
  subject: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4000).optional(),
  occurredAt: z.string().datetime().optional(),
  durationMin: z.number().min(0).max(1440).optional(),
  nextFollowupAt: z.string().datetime().optional(),
});

async function assertClientVisible(tx: any, session: any, investorId: string) {
  const [inv] = await tx
    .select({ id: investors.id, name: investors.name, phone: investors.phone, rmId: investors.rmId, serviceRmId: investors.serviceRmId, branchId: investors.branchId })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId)))
    .limit(1);
  if (!inv) throw Object.assign(new Error("client not found"), { status: 404 });
  await assertCanViewClient(tx, session, inv);
  return inv;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      await assertClientVisible(tx, session, id);
      const r = await tx.execute(sql`
        SELECT a.id, a.direction, a.status, a.subject, a.notes, a.occurred_at,
               a.duration_sec, a.next_followup_at, a.owner_user_id, u.name AS author_name
        FROM activities a
        LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.subject_type = 'investor'
          AND a.subject_id = ${id}::uuid
          AND a.kind = 'call'
        ORDER BY a.occurred_at DESC
        LIMIT 300
      `);
      return r.rows;
    });
    return NextResponse.json({ calls: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid call details", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const callId = uuid();

    await withTenant(session.tenantId, async (tx) => {
      const inv = await assertClientVisible(tx, session, id);
      await tx.insert(activities).values({
        id: callId,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        subjectType: "investor",
        subjectId: id,
        subjectName: inv.name ?? null,
        subjectPhone: inv.phone ?? null,
        kind: "call",
        direction: b.direction,
        status: b.status,
        subject: b.subject || null,
        notes: b.notes || null,
        occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
        durationSec: b.durationMin != null ? Math.round(b.durationMin * 60) : null,
        nextFollowupAt: b.nextFollowupAt ? new Date(b.nextFollowupAt) : null,
        ownerUserId: session.userId,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.call.log",
        entityType: "investor",
        entityId: id,
        after: { callId, direction: b.direction, status: b.status },
        ...meta,
      });
    });

    return NextResponse.json({ id: callId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
