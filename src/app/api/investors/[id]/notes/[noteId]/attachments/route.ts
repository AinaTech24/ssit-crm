import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/notes/[noteId]/attachments - multipart, repeated `files`
 *
 * Images (JPG, PNG, WEBP, GIF) and PDFs only, 15 MB each, 10 at a time. Only the note's author may add files to
 * it. The type is read from the file's own bytes, never from what the browser claims.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activities, clientNoteAttachments } from "@/db/schema";
import { putObject } from "@/lib/storage/s3";
import { sniffMime } from "@/lib/storage/file-sniff";
import { assertClientNotesVisible, isClientsServiceRm } from "@/lib/investors/note-access";
import { NOTE_FILE_MAX_BYTES, NOTE_FILE_MAX_COUNT, NOTE_FILE_TYPES } from "@/lib/investors/note-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "multipart body required" }, { status: 400 });
    const picked = form.getAll("files").filter((f): f is File => typeof f !== "string" && f !== null);
    if (picked.length === 0) return NextResponse.json({ error: "choose at least one image or PDF" }, { status: 400 });
    if (picked.length > NOTE_FILE_MAX_COUNT) return NextResponse.json({ error: `at most ${NOTE_FILE_MAX_COUNT} files at a time` }, { status: 400 });
    const tooBig = picked.find((f) => f.size > NOTE_FILE_MAX_BYTES);
    if (tooBig) return NextResponse.json({ error: `"${tooBig.name}" is larger than 15 MB` }, { status: 400 });

    // Read and check the bytes before opening the transaction.
    const staged: Array<{ name: string; type: string; buf: Buffer }> = [];
    for (const f of picked) {
      const buf = Buffer.from(await f.arrayBuffer());
      const type = sniffMime(buf);
      if (!type || !NOTE_FILE_TYPES.includes(type)) {
        return NextResponse.json({ error: `"${f.name}" is not an image or a PDF` }, { status: 400 });
      }
      staged.push({ name: (f.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 180), type, buf });
    }

    const outcome = await withTenant(session.tenantId, async (tx) => {
      // Servicing RM of this client, or someone who may view clients; the client wall is checked next.
      if (!(await isClientsServiceRm(tx, session, id))) {
        requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
      }
      await assertClientNotesVisible(tx, session, id);
      const [note] = await tx
        .select({ id: activities.id, ownerUserId: activities.ownerUserId })
        .from(activities)
        .where(
          and(
            eq(activities.id, noteId),
            eq(activities.tenantId, session.tenantId),
            eq(activities.subjectType, "investor"),
            eq(activities.subjectId, id)
          )
        )
        .limit(1);
      if (!note) return "not_found" as const;
      if (note.ownerUserId !== session.userId) return "forbidden" as const;

      const rows = [];
      for (const s of staged) {
        const rand = Math.random().toString(36).slice(2, 10);
        const storageKey = `tenants/${session.tenantId}/client-notes/${noteId}/${rand}-${s.name}`;
        await putObject(storageKey, s.buf, s.type);
        const [row] = await tx
          .insert(clientNoteAttachments)
          .values({
            tenantId: session.tenantId,
            activityId: noteId,
            uploadedBy: session.userId,
            fileName: s.name,
            contentType: s.type,
            sizeBytes: s.buf.length,
            storageKey,
          })
          .returning({ id: clientNoteAttachments.id });
        rows.push(row);
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.note.attachment.add",
        entityType: "investor",
        entityId: id,
        after: { noteId, count: rows.length },
        ...clientMetaFromHeaders(req.headers),
      });
      return { count: rows.length };
    });

    if (outcome === "not_found") return NextResponse.json({ error: "note not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only add files to your own notes" }, { status: 403 });
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
