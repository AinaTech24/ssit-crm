import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    .../notes/[noteId]/attachments/[attId]  - view (or ?download=1) one file
 * DELETE .../notes/[noteId]/attachments/[attId]  - remove it (the note's author)
 *
 * The bytes are proxied so the client-access check runs on every request and storage stays private. Only the
 * image / PDF types accepted at upload are ever served, with nosniff.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { activities, clientNoteAttachments } from "@/db/schema";
import { getObjectBytes } from "@/lib/storage/s3";
import { assertClientNotesVisible, isClientsServiceRm } from "@/lib/investors/note-access";
import { NOTE_FILE_TYPES } from "@/lib/investors/note-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; noteId: string; attId: string }> };

async function load(tx: any, tenantId: string, investorId: string, noteId: string, attId: string) {
  const [row] = await tx
    .select({ file: clientNoteAttachments, ownerUserId: activities.ownerUserId })
    .from(clientNoteAttachments)
    .innerJoin(activities, eq(activities.id, clientNoteAttachments.activityId))
    .where(
      and(
        eq(clientNoteAttachments.id, attId),
        eq(clientNoteAttachments.activityId, noteId),
        eq(clientNoteAttachments.tenantId, tenantId),
        isNull(clientNoteAttachments.deletedAt),
        eq(activities.subjectType, "investor"),
        eq(activities.subjectId, investorId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id, noteId, attId } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => {
      await assertClientNotesVisible(tx, session, id);
      return load(tx, session.tenantId, id, noteId, attId);
    });
    if (!row || !NOTE_FILE_TYPES.includes(row.file.contentType)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const bytes = await getObjectBytes(row.file.storageKey);
    const how = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": row.file.contentType,
        "Content-Disposition": `${how}; filename="${encodeURIComponent(row.file.fileName)}"`,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, noteId, attId } = await params;
  try {
    const session = await requireSession();
    const outcome = await withTenant(session.tenantId, async (tx) => {
      if (!(await isClientsServiceRm(tx, session, id))) {
        requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
      }
      await assertClientNotesVisible(tx, session, id);
      const row = await load(tx, session.tenantId, id, noteId, attId);
      if (!row) return "not_found" as const;
      if (row.ownerUserId !== session.userId) return "forbidden" as const;
      await tx.update(clientNoteAttachments).set({ deletedAt: new Date() }).where(eq(clientNoteAttachments.id, attId));
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only remove files from your own notes" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
