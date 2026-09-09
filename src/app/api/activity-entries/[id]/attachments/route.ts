import { handleApiError } from "@/lib/api/error-handler";
/**
 * Activity-entry file attachments.
 *
 *   GET  /api/activity-entries/[id]/attachments  — list (uploader names)
 *   POST /api/activity-entries/[id]/attachments  — multipart upload. Accepts a single
 *        `file` or a repeated `files` field, so one picker handles both.
 *
 * Server-side upload (small files): the buffer is written to S3 under a
 * tenant-scoped key. Download is via the secure streaming route.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activityEntries, activityAttachments, users } from "@/db/schema";
import { putObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
// Bound on ONE request, not on a task. The client chunks a larger pick.
const MAX_FILES_PER_REQUEST = 20;

/** Own entry, or one you assigned — same rule as the entry PATCH. */
function ownsActivity(a: { ownerUserId: string | null; assignedByUserId: string | null }, userId: string): boolean {
  return a.ownerUserId === userId || a.assignedByUserId === userId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ ownerUserId: activityEntries.ownerUserId, assignedByUserId: activityEntries.assignedByUserId })
        .from(activityEntries)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return null;
      if (!canViewAll && !ownsActivity(t, session.userId)) return null;
      return tx
        .select({ a: activityAttachments, uploaderName: users.name })
        .from(activityAttachments)
        .leftJoin(users, eq(users.id, activityAttachments.uploadedBy))
        .where(and(eq(activityAttachments.activityId, id), eq(activityAttachments.tenantId, session.tenantId), isNull(activityAttachments.deletedAt)))
        .orderBy(desc(activityAttachments.createdAt));
    });
    if (rows === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ attachments: rows.map((r) => ({ ...r.a, uploaderName: r.uploaderName })) });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const form = await req.formData().catch(() => null);
    // `files` is the multi-select field; `file` is the original single-file
    // contract, still honoured so nothing that posts one file has to change.
    const picked = [...(form?.getAll("files") ?? []), ...(form?.getAll("file") ?? [])].filter(
      (v): v is File => typeof v !== "string" && v != null
    );
    if (picked.length === 0) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (picked.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ error: `at most ${MAX_FILES_PER_REQUEST} files per request` }, { status: 400 });
    }
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) return NextResponse.json({ error: `"${tooBig.name}" exceeds 25 MB` }, { status: 400 });

    // Read + name every file BEFORE opening the transaction, so a slow client
    // upload never holds a DB connection open.
    const staged = await Promise.all(
      picked.map(async (file, i) => {
        const safeName = (file.name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 180);
        const buf = Buffer.from(await file.arrayBuffer());
        // Tenant-scoped key. The index keeps two identically-named,
        // identically-sized files in ONE pick from colliding on the same key.
        const rand =
          Math.abs(buf.length ^ (safeName.length * 2654435761)).toString(36) +
          safeName.length.toString(36) +
          i.toString(36);
        return {
          file,
          safeName,
          buf,
          storageKey: `tenants/${session.tenantId}/activity/${id}/${rand}-${safeName}`,
        };
      })
    );

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ ownerUserId: activityEntries.ownerUserId, assignedByUserId: activityEntries.assignedByUserId })
        .from(activityEntries)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return "not_found" as const;
      if (!canEditAll && !ownsActivity(t, session.userId)) return "forbidden" as const;

      for (const st of staged) {
        await putObject(st.storageKey, st.buf, st.file.type || "application/octet-stream");
      }

      const rows = await tx
        .insert(activityAttachments)
        .values(
          staged.map((st) => ({
            tenantId: session.tenantId,
            activityId: id,
            uploadedBy: session.userId,
            fileName: st.safeName,
            contentType: st.file.type || null,
            sizeBytes: st.file.size,
            storageKey: st.storageKey,
          }))
        )
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "activity.attachment.add",
        entityType: "activity_entry",
        entityId: id,
        after: { attachmentIds: rows.map((r) => r.id), fileNames: staged.map((st) => st.safeName) },
        ...clientMeta,
      });
      // `attachment` (singular) kept for the original single-file contract.
      return { attachments: rows, attachment: rows[0] } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only attach to your own activity entries" }, { status: 403 });
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
