import { handleApiError } from "@/lib/api/error-handler";
/**
 * Review-meeting file attachments.
 *
 *   GET  /api/review-meetings/[id]/attachments  — list (with uploader names)
 *   POST /api/review-meetings/[id]/attachments  — multipart upload
 *
 * The POST accepts MANY files in one request: repeat the `files` field (the
 * schedule form sends everything the user picked in a single call). A single
 * `file` field is also accepted so the endpoint matches the task-attachment
 * shape. Each file is written to S3 under a tenant + meeting scoped key via
 * lib/storage/s3.ts, which falls back to the local uploads volume when no S3
 * credentials are configured.
 *
 * Access mirrors the meeting itself: review_meeting.manage.all sees every
 * meeting, review_meeting.manage.assigned only its own (rm_id = caller).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reviewMeetings, reviewMeetingAttachments, users } from "@/db/schema";
import { putObject } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-file ceiling. Matches task attachments so the two feel the same.
// NOT exported — a Next route module may only export route handlers and the
// known config keys, and anything else fails the generated route type check.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
/** Guards a single request from being used to bulk-dump into the bucket. */
const MAX_FILES_PER_REQUEST = 20;

/** Filesystem/S3-safe display name, capped so keys stay reasonable. */
function safeFileName(name: string): string {
  return (name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 180);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);

    const rows = await withTenant(session.tenantId, async (tx) => {
      const [m] = await tx
        .select({ rmId: reviewMeetings.rmId })
        .from(reviewMeetings)
        .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)))
        .limit(1);
      if (!m) return null;
      if (!canAll && m.rmId !== session.userId) return null;
      return tx
        .select({ a: reviewMeetingAttachments, uploaderName: users.name })
        .from(reviewMeetingAttachments)
        .leftJoin(users, eq(users.id, reviewMeetingAttachments.uploadedBy))
        .where(
          and(
            eq(reviewMeetingAttachments.meetingId, id),
            eq(reviewMeetingAttachments.tenantId, session.tenantId),
            isNull(reviewMeetingAttachments.deletedAt)
          )
        )
        .orderBy(desc(reviewMeetingAttachments.createdAt));
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
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "multipart body required" }, { status: 400 });

    // Accept `files` (repeated, the multi-select case) and `file` (single).
    const picked = [...form.getAll("files"), ...form.getAll("file")].filter(
      (f): f is File => typeof f !== "string" && f !== null
    );
    if (picked.length === 0) return NextResponse.json({ error: "at least one file is required" }, { status: 400 });
    if (picked.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ error: `at most ${MAX_FILES_PER_REQUEST} files per upload` }, { status: 400 });
    }
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      return NextResponse.json({ error: `"${tooBig.name}" exceeds 25 MB` }, { status: 400 });
    }

    // Read the bytes BEFORE opening the transaction — the request stream must
    // not be consumed while a DB connection is held open.
    const staged = await Promise.all(
      picked.map(async (f) => ({
        file: f,
        name: safeFileName(f.name),
        buf: Buffer.from(await f.arrayBuffer()),
      }))
    );

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [m] = await tx
        .select({ rmId: reviewMeetings.rmId })
        .from(reviewMeetings)
        .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)))
        .limit(1);
      if (!m) return "not_found" as const;
      if (!canAll && m.rmId !== session.userId) return "forbidden" as const;

      const inserted = [];
      for (const s of staged) {
        // A random-ish segment keeps two same-name files on one meeting apart.
        const rand = Math.random().toString(36).slice(2, 10);
        const storageKey = `tenants/${session.tenantId}/review-meetings/${id}/${rand}-${s.name}`;
        await putObject(storageKey, s.buf, s.file.type || "application/octet-stream");

        const [row] = await tx
          .insert(reviewMeetingAttachments)
          .values({
            tenantId: session.tenantId,
            meetingId: id,
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
        action: "review_meeting.attachment.add",
        entityType: "review_meeting",
        entityId: id,
        after: { count: inserted.length, fileNames: inserted.map((r) => r.fileName) } as any,
        ...clientMeta,
      });

      return { attachments: inserted } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") {
      return NextResponse.json({ error: "you can only attach files to your own meetings" }, { status: 403 });
    }
    return NextResponse.json(outcome, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
