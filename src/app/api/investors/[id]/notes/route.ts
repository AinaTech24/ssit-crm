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
import { assertActiveLicense } from "@/lib/auth/license";
import { assertClientNotesVisible, isClientsServiceRm } from "@/lib/investors/note-access";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activities } from "@/db/schema";
import { notifyClientTeam } from "@/lib/notifications/client-team";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    note: z.string().trim().max(4000).default(""),
    /** Files follow in a second request; a note may then have no text. */
    withFiles: z.boolean().optional(),
  })
  .refine((b) => b.note.length > 0 || b.withFiles === true, { message: "a note cannot be empty" });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      await assertClientNotesVisible(tx, session, id);
      const r = await tx.execute(sql`
        SELECT a.id, a.kind, a.subject, a.notes, a.occurred_at, a.owner_user_id, a.created_at, a.updated_at,
               u.name AS author_name,
               (SELECT COALESCE(json_agg(json_build_object('id', f.id, 'fileName', f.file_name, 'contentType', f.content_type, 'sizeBytes', f.size_bytes) ORDER BY f.created_at), '[]'::json)
                  FROM client_note_attachments f
                 WHERE f.activity_id = a.id AND f.deleted_at IS NULL) AS files
        FROM activities a
        LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.subject_type = 'investor'
          AND a.subject_id = ${id}::uuid
          -- A note typed here, and the notes of every call / visit / WhatsApp / email /
          -- SMS logged against the client — whichever type it was logged as, what was
          -- written down belongs in the one running history.
          AND a.kind IN ('note', 'call', 'visit', 'whatsapp', 'email', 'sms')
          AND (a.kind = 'note' OR NULLIF(btrim(COALESCE(a.notes, '')), '') IS NOT NULL)
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
      // Servicing RM of this client, or someone who may view clients; the client wall is checked next.
      if (!(await isClientsServiceRm(tx, session, id))) {
        requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
      }
      const inv = await assertClientNotesVisible(tx, session, id);
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
        notes: parse.data.note || null,
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
      await notifyClientTeam(tx, {
        tenantId: session.tenantId,
        investorId: id,
        actorUserId: session.userId,
        kind: "client.meeting_note",
        title: "Meeting notes added for {client}",
        body: parse.data.note.slice(0, 240) || "Files attached to a note",
      });
    });

    return NextResponse.json({ id: noteId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
