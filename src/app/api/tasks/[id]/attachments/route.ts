import { handleApiError } from "@/lib/api/error-handler";
/**
 * Task file attachments.
 *
 *   GET  /api/tasks/[id]/attachments  — list (uploader names)
 *   POST /api/tasks/[id]/attachments  — multipart upload (field `file`)
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
import { tasks, taskAttachments, users } from "@/db/schema";
import { putObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

function ownsTask(t: { assigneeId: string | null; createdById: string | null }, userId: string): boolean {
  return t.assigneeId === userId || t.createdById === userId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ assigneeId: tasks.assigneeId, createdById: tasks.createdById })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return null;
      if (!canViewAll && !ownsTask(t, session.userId)) return null;
      return tx
        .select({ a: taskAttachments, uploaderName: users.name })
        .from(taskAttachments)
        .leftJoin(users, eq(users.id, taskAttachments.uploadedBy))
        .where(and(eq(taskAttachments.taskId, id), eq(taskAttachments.tenantId, session.tenantId), isNull(taskAttachments.deletedAt)))
        .orderBy(desc(taskAttachments.createdAt));
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
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file exceeds 25 MB" }, { status: 400 });
    const safeName = (file.name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 180);
    const buf = Buffer.from(await file.arrayBuffer());
    // Tenant-scoped key; a random segment avoids collisions on same-name files.
    const rand = Math.abs(buf.length ^ (safeName.length * 2654435761)).toString(36) + safeName.length.toString(36);
    const storageKey = `tenants/${session.tenantId}/tasks/${id}/${rand}-${safeName}`;

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ assigneeId: tasks.assigneeId, createdById: tasks.createdById })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!t) return "not_found" as const;
      if (!canEditAll && !ownsTask(t, session.userId)) return "forbidden" as const;

      await putObject(storageKey, buf, file.type || "application/octet-stream");

      const [row] = await tx
        .insert(taskAttachments)
        .values({
          tenantId: session.tenantId,
          taskId: id,
          uploadedBy: session.userId,
          fileName: safeName,
          contentType: file.type || null,
          sizeBytes: file.size,
          storageKey,
        })
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.attachment.add",
        entityType: "task",
        entityId: id,
        after: { attachmentId: row.id, fileName: safeName } as any,
        ...clientMeta,
      });
      return { attachment: row } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only attach to your own tasks" }, { status: 403 });
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
