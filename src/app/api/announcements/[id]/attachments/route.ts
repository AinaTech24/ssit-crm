import { handleApiError } from "@/lib/api/error-handler";
/**
 * Announcement file attachments — documents, images and video.
 *
 *   GET  /api/announcements/[id]/attachments  — list (uploader names)
 *   POST /api/announcements/[id]/attachments  — multipart upload. Accepts a
 *        single `file` or a repeated `files` field, so one picker handles both.
 *
 * Reading follows the notice: anyone the announcement is addressed to may list
 * and download its files (see lib/announcements/access.ts). Attaching is
 * owner / branch-head work, the same gate as posting the notice itself.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { announcementAttachments, users } from "@/db/schema";
import { putObject } from "@/lib/storage/s3";
import { canViewAnnouncement, isAnnouncementManager as isManager } from "@/lib/announcements/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — keep in sync with EntityAttachments
// Bound on ONE request, not on an announcement. The client chunks a larger pick.
const MAX_FILES_PER_REQUEST = 20;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      if (!(await canViewAnnouncement(tx, session, id))) return null;
      return tx
        .select({ a: announcementAttachments, uploaderName: users.name })
        .from(announcementAttachments)
        .leftJoin(users, eq(users.id, announcementAttachments.uploadedBy))
        .where(
          and(
            eq(announcementAttachments.announcementId, id),
            eq(announcementAttachments.tenantId, session.tenantId),
            isNull(announcementAttachments.deletedAt)
          )
        )
        .orderBy(desc(announcementAttachments.createdAt));
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
    if (!isManager(session.roles)) {
      return NextResponse.json(
        { error: "only owners / branch heads can attach files to an announcement" },
        { status: 403 }
      );
    }
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const form = await req.formData().catch(() => null);
    // `files` is the multi-select field; `file` is the single-file contract.
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
          storageKey: `tenants/${session.tenantId}/announcements/${id}/${rand}-${safeName}`,
        };
      })
    );

    const outcome = await withTenant(session.tenantId, async (tx) => {
      if (!(await canViewAnnouncement(tx, session, id))) return "not_found" as const;

      for (const st of staged) {
        await putObject(st.storageKey, st.buf, st.file.type || "application/octet-stream");
      }

      const rows = await tx
        .insert(announcementAttachments)
        .values(
          staged.map((st) => ({
            tenantId: session.tenantId,
            announcementId: id,
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
        action: "announcement.attachment.add",
        entityType: "announcement",
        entityId: id,
        after: { attachmentIds: rows.map((r) => r.id), fileNames: staged.map((st) => st.safeName) },
        ...clientMeta,
      });
      return { attachments: rows, attachment: rows[0] } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
