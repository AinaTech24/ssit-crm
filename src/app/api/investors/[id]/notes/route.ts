import { handleApiError } from "@/lib/api/error-handler";
/**
 * Notes on a client.
 *
 *   GET  /api/investors/[id]/notes  — every note on this client, newest first
 *   POST /api/investors/[id]/notes  — add one
 *
 * Stored as `activities` rows with kind='note' — the existing interaction log
 * already models "one timestamped entry against a client", so a note joins the
 * same feed rather than a parallel table nobody else reads.
 *
 * WHY NOT /api/activities?kind=note&subjectId=…: that list is scoped to rows
 * you OWN unless you hold dashboard.view.owner, which is right for the
 * activity tracker ("my work") and wrong here. Notes on a shared client are
 * shared: a servicing RM must read what the relationship RM wrote, or the
 * section shows each person a different client history. Visibility is
 * therefore decided by the CLIENT wall — if you can open the client, you can
 * read its notes — and nothing else.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activities, investors } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().trim().min(1).max(4000),
});

/**
 * The client's own Service RM may read and add notes on it whatever their role's
 * capabilities say — being assigned as the client's service RM is exactly the
 * relationship notes exist for, and it must not depend on the role also holding
 * the view-clients capability. Everyone else goes through the normal client wall.
 */
async function isClientsServiceRm(tx: any, session: any, investorId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: investors.id })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId), eq(investors.serviceRmId, session.userId)))
    .limit(1);
  return !!row;
}

/** Load the client and throw unless this session may open it. */
async function assertClientVisible(tx: any, session: any, investorId: string) {
  if (await isClientsServiceRm(tx, session, investorId)) {
    const [inv] = await tx
      .select({ id: investors.id, name: investors.name, phone: investors.phone })
      .from(investors)
      .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId)))
      .limit(1);
    return inv;
  }
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
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
    const rows = await withTenant(session.tenantId, async (tx) => {
      await assertClientVisible(tx, session, id);
      const r = await tx.execute(sql`
        SELECT a.id, a.notes, a.occurred_at, a.owner_user_id, a.created_at, a.updated_at,
               u.name AS author_name
        FROM activities a
        LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.subject_type = 'investor'
          AND a.subject_id = ${id}::uuid
          AND a.kind = 'note'
        ORDER BY a.occurred_at DESC
        LIMIT 300
      `);
      return r.rows;
    });
    return NextResponse.json({ notes: rows, userId: session.userId });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "a note cannot be empty", issues: parse.error.issues }, { status: 400 });
    }
    const meta = clientMetaFromHeaders(req.headers);
    const noteId = uuid();

    await withTenant(session.tenantId, async (tx) => {
      const inv = await assertClientVisible(tx, session, id);
      await tx.insert(activities).values({
        id: noteId,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        subjectType: "investor",
        subjectId: id,
        // Denormalised so the row still reads correctly if the client is
        // renamed later — same contract as every other activity row.
        subjectName: inv.name ?? null,
        subjectPhone: inv.phone ?? null,
        kind: "note",
        notes: parse.data.note,
        occurredAt: new Date(),
        ownerUserId: session.userId,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.note.create",
        entityType: "investor",
        entityId: id,
        after: { noteId },
        ...meta,
      });
    });

    return NextResponse.json({ id: noteId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
