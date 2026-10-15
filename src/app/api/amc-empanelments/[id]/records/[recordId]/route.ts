import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/amc-empanelments/[id]/records/[recordId]?kind=meeting|note
 *
 * Removes one meeting or note. Same gate as writing them: whoever maintains
 * the panel maintains its history. `kind` says which table to look in — the two
 * have separate id spaces, and guessing would mean two queries on every delete.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { amcMeetings, amcNotes } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  const { id, recordId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["amc_meeting.view"], session.permissions);
    const kind = req.nextUrl.searchParams.get("kind") === "note" ? "note" : "meeting";
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      if (kind === "meeting") {
        const [row] = await tx
          .select()
          .from(amcMeetings)
          .where(
            and(
              eq(amcMeetings.id, recordId),
              eq(amcMeetings.tenantId, session.tenantId),
              eq(amcMeetings.amcEmpanelmentId, id)
            )
          )
          .limit(1);
        if (!row) return "not_found" as const;
        await tx
          .delete(amcMeetings)
          .where(and(eq(amcMeetings.id, recordId), eq(amcMeetings.tenantId, session.tenantId)));
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "amc.meeting.delete",
          entityType: "amc_empanelment",
          entityId: id,
          before: { recordId, subject: row.subject, meetingDate: row.meetingDate },
          ...meta,
        });
        return "ok" as const;
      }

      const [row] = await tx
        .select()
        .from(amcNotes)
        .where(
          and(
            eq(amcNotes.id, recordId),
            eq(amcNotes.tenantId, session.tenantId),
            eq(amcNotes.amcEmpanelmentId, id)
          )
        )
        .limit(1);
      if (!row) return "not_found" as const;
      await tx
        .delete(amcNotes)
        .where(and(eq(amcNotes.id, recordId), eq(amcNotes.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "amc.note.delete",
        entityType: "amc_empanelment",
        entityId: id,
        before: { recordId, note: row.note },
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
