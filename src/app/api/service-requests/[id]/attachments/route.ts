import { handleApiError } from "@/lib/api/error-handler";
/**
 * Service-request file attachments.
 *
 *   GET  /api/service-requests/[id]/attachments  — list (with uploader names)
 *   POST /api/service-requests/[id]/attachments  — multipart upload (repeat `files`)
 *
 * Same shape as the meeting / task attachment routes, so the shared
 * EntityAttachments component drives all three. Files are written to S3 under a
 * tenant + request scoped key via lib/storage/s3.ts (local-disk fallback when no
 * S3 credentials are configured).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { serviceRequests, serviceRequestAttachments, users } from "@/db/schema";
import { putObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — same ceiling as tasks and meetings
const MAX_FILES_PER_REQUEST = 20;

const VIEW_CAPS = ["service_request.view.all", "service_request.view.assigned", "service_request.manage", "service_request.create"] as const;
const WRITE_CAPS = ["service_request.manage", "service_request.create"] as const;

function safeFileName(name: string): string {
  return (name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 180);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const [sr] = await tx
        .select({ id: serviceRequests.id })
        .from(serviceRequests)
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId)))
        .limit(1);
      if (!sr) return null;
      return tx
        .select({ a: serviceRequestAttachments, uploaderName: users.name })
        .from(serviceRequestAttachments)
        .leftJoin(users, eq(users.id, serviceRequestAttachments.uploadedBy))
        .where(
          and(
            eq(serviceRequestAttachments.serviceRequestId, id),
            eq(serviceRequestAttachments.tenantId, session.tenantId),
            isNull(serviceRequestAttachments.deletedAt)
          )
        )
        .orderBy(desc(serviceRequestAttachments.createdAt));
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
    requireAny(session.roles, [...WRITE_CAPS], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "multipart body required" }, { status: 400 });

    const picked = [...form.getAll("files"), ...form.getAll("file")].filter(
      (f): f is File => typeof f !== "string" && f !== null
    );
    if (picked.length === 0) return NextResponse.json({ error: "at least one file is required" }, { status: 400 });
    if (picked.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ error: `at most ${MAX_FILES_PER_REQUEST} files per upload` }, { status: 400 });
    }
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) return NextResponse.json({ error: `"${tooBig.name}" exceeds 25 MB` }, { status: 400 });

    // Read the bytes BEFORE opening the transaction — the request stream must not
    // be consumed while a DB connection is held open.
    const staged = await Promise.all(
      picked.map(async (f) => ({ file: f, name: safeFileName(f.name), buf: Buffer.from(await f.arrayBuffer()) }))
    );

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [sr] = await tx
        .select({ id: serviceRequests.id })
        .from(serviceRequests)
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId)))
        .limit(1);
      if (!sr) return "not_found" as const;

      const inserted = [];
      for (const s of staged) {
        const rand = Math.random().toString(36).slice(2, 10);
        const storageKey = `tenants/${session.tenantId}/service-requests/${id}/${rand}-${s.name}`;
        await putObject(storageKey, s.buf, s.file.type || "application/octet-stream");
        const [row] = await tx
          .insert(serviceRequestAttachments)
          .values({
            tenantId: session.tenantId,
            serviceRequestId: id,
            uploadedBy: session.userId,
            fileName: s.name,
            contentType: s.file.type || null,
            sizeBytes: s.file.size,
            storageKey,
          })
          .returning();
        inserted.push(row);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_request.attachment.add",
        entityType: "service_request",
        entityId: id,
        after: { count: inserted.length, fileNames: inserted.map((r) => r.fileName) },
        ...clientMeta,
      });
      return { attachments: inserted } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
