import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single activity.
 *
 *   GET    /api/activities/[id]  — one activity's full detail (mobile detail screen)
 *   PATCH  /api/activities/[id]  — edit outcome/notes/status/follow-up
 *   DELETE /api/activities/[id]  — remove a mis-logged activity
 *
 * Authors can edit their own; managers (owner/branch_head) can edit any.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ACTIVITY_DIRECTIONS, ACTIVITY_STATUSES, activities } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.id, a.kind, a.direction, a.status, a.subject, a.notes,
               a.occurred_at, a.duration_sec, a.next_followup_at,
               a.subject_type, a.subject_id, a.subject_name, a.subject_phone,
               a.owner_user_id, a.location_label, a.geo_lat, a.geo_lng,
               u.name AS owner_name
        FROM activities a
        LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid AND a.id = ${id}::uuid
        LIMIT 1
      `);
      return r.rows[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Patch = z.object({
  subject: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: z.enum(ACTIVITY_STATUSES).nullable().optional(),
  direction: z.enum(ACTIVITY_DIRECTIONS).nullable().optional(),
  durationSec: z.number().int().min(0).max(86400).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  nextFollowupAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const isManager = can(session.roles, "dashboard.view.owner", (session as any).permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const before = (
          await tx.select().from(activities).where(and(eq(activities.id, id), eq(activities.tenantId, session.tenantId))).limit(1)
        )[0];
        if (!before) return null;
        if (!isManager && before.ownerUserId !== session.userId) return "forbidden" as const;

        const patch: any = { updatedAt: new Date() };
        const d = parse.data;
        if (d.subject !== undefined) patch.subject = d.subject;
        if (d.notes !== undefined) patch.notes = d.notes;
        if (d.status !== undefined) patch.status = d.status;
        if (d.direction !== undefined) patch.direction = d.direction;
        if (d.durationSec !== undefined) patch.durationSec = d.durationSec;
        if (d.occurredAt !== undefined) patch.occurredAt = new Date(d.occurredAt);
        if (d.nextFollowupAt !== undefined) patch.nextFollowupAt = d.nextFollowupAt ? new Date(d.nextFollowupAt) : null;

        const next = await tx
          .update(activities)
          .set(patch)
          .where(and(eq(activities.id, id), eq(activities.tenantId, session.tenantId)))
          .returning();
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "activity.update",
          entityType: "activity",
          entityId: id,
          after: d as any,
          ...meta,
        });
        return next[0];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (result === "forbidden") return NextResponse.json({ error: "not allowed" }, { status: 403 });
    return NextResponse.json({ activity: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const isManager = can(session.roles, "dashboard.view.owner", (session as any).permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const before = (
          await tx.select().from(activities).where(and(eq(activities.id, id), eq(activities.tenantId, session.tenantId))).limit(1)
        )[0];
        if (!before) return null;
        if (!isManager && before.ownerUserId !== session.userId) return "forbidden" as const;
        await tx.delete(activities).where(and(eq(activities.id, id), eq(activities.tenantId, session.tenantId)));
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "activity.delete",
          entityType: "activity",
          entityId: id,
          ...meta,
        });
        return before;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (result === "forbidden") return NextResponse.json({ error: "not allowed" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
