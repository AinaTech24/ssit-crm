import { handleApiError } from "@/lib/api/error-handler";
/**
 * Meetings and notes on an AMC empanelment.
 *
 *   GET  /api/amc-empanelments/[id]/records  — both, newest first
 *   POST /api/amc-empanelments/[id]/records  — add one ({ kind: 'meeting' | 'note' })
 *
 * One endpoint for both because the AMC detail page shows them as one history.
 * They are separate TABLES because their shapes differ (see db/schema/
 * amc_records.ts); they are one ROUTE because "what happened with this AMC" is
 * a single question.
 *
 * Gated on compliance.edit, the capability that already owns the empanelment
 * record — whoever maintains the panel maintains its history.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { amcEmpanelments, amcMeetings, amcNotes } from "@/db/schema";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("meeting"),
    meetingDate: z.string().regex(ISO, "expected yyyy-mm-dd"),
    subject: z.string().trim().min(1).max(300),
    attendees: z.string().max(1000).nullish(),
    notes: z.string().max(8000).nullish(),
    followUp: z.string().max(2000).nullish(),
  }),
  z.object({
    kind: z.literal("note"),
    note: z.string().trim().min(1).max(8000),
    notedOn: z.string().regex(ISO).nullish(),
  }),
]);

/** 404 unless this empanelment exists in the caller's tenant. */
async function assertAmc(tx: any, tenantId: string, amcId: string) {
  const [row] = await tx
    .select({ id: amcEmpanelments.id, amcName: amcEmpanelments.amcName })
    .from(amcEmpanelments)
    .where(and(eq(amcEmpanelments.id, amcId), eq(amcEmpanelments.tenantId, tenantId)))
    .limit(1);
  if (!row) throw Object.assign(new Error("AMC empanelment not found"), { status: 404 });
  return row;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["amc_meeting.view"], session.permissions);

    const data = await withTenant(session.tenantId, async (tx) => {
      await assertAmc(tx, session.tenantId, id);
      const [meetings, notes] = await Promise.all([
        tx.execute(sql`
          SELECT m.id, m.meeting_date, m.subject, m.attendees, m.notes, m.follow_up,
                 m.created_at, u.name AS author_name
            FROM amc_meetings m
            LEFT JOIN users u ON u.id = m.created_by_user_id
           WHERE m.tenant_id = ${session.tenantId}::uuid
             AND m.amc_empanelment_id = ${id}::uuid
           ORDER BY m.meeting_date DESC
           LIMIT 200
        `),
        tx.execute(sql`
          SELECT n.id, n.note, n.noted_on, n.created_at, u.name AS author_name
            FROM amc_notes n
            LEFT JOIN users u ON u.id = n.created_by_user_id
           WHERE n.tenant_id = ${session.tenantId}::uuid
             AND n.amc_empanelment_id = ${id}::uuid
           ORDER BY n.created_at DESC
           LIMIT 200
        `),
      ]);
      return { meetings: meetings.rows, notes: notes.rows };
    });

    return NextResponse.json({ ...data, userId: session.userId });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["amc_meeting.add"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const newId = uuid();

    await withTenant(session.tenantId, async (tx) => {
      const amc = await assertAmc(tx, session.tenantId, id);

      if (body.kind === "meeting") {
        await tx.insert(amcMeetings).values({
          id: newId,
          tenantId: session.tenantId,
          amcEmpanelmentId: id,
          meetingDate: body.meetingDate,
          subject: body.subject,
          attendees: body.attendees ?? null,
          notes: body.notes ?? null,
          followUp: body.followUp ?? null,
          createdByUserId: session.userId,
        });
      } else {
        await tx.insert(amcNotes).values({
          id: newId,
          tenantId: session.tenantId,
          amcEmpanelmentId: id,
          note: body.note,
          notedOn: body.notedOn ?? null,
          createdByUserId: session.userId,
        });
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `amc.${body.kind}.create`,
        entityType: "amc_empanelment",
        entityId: id,
        after: { recordId: newId, amcName: amc.amcName },
        ...meta,
      });
    });

    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
