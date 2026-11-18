import { handleApiError } from "@/lib/api/error-handler";
/**
 * Lead documents - the same files a client can hold, kept on the lead before it
 * becomes one.
 *
 *   GET    /api/leads/[id]/documents          - list this lead's documents
 *   POST   /api/leads/[id]/documents          - register an uploaded file
 *   DELETE /api/leads/[id]/documents?docId=   - remove a document
 *
 * Backed by the shared `compliance_documents` table (relatedEntityType='lead'),
 * exactly as the public required-documents form already files a lead's uploads.
 * Converting the lead to a client moves these onto the client (see the convert
 * route), so nothing has to be uploaded twice.
 *
 * Upload: the browser POSTs the file here (multipart/form-data, field "file"); this
 * route stores it in the document vault and files it against the lead in one step.
 *
 * Who may: anyone who may OPEN the lead (inside their data wall) may see its
 * documents; anyone who may EDIT the lead may add and remove them. These follow the
 * lead, NOT the separate Documents capability - a role that can work a lead (an RM, a
 * branch head) was being locked out of its documents whenever that capability was not
 * ticked on their record.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { complianceDocuments } from "@/db/schema";
import { deleteObject, putObject, vaultKey } from "@/lib/storage/s3";
import { contentTypeMatches } from "@/lib/storage/file-sniff";
import { firmFolderName } from "@/lib/storage/firm-folder";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadEditableLead, loadViewableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

/** Largest file accepted per document. */
const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadViewableLead(tx, session, id);
      if (!lead) return null;
      return tx
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "lead"),
            eq(complianceDocuments.relatedEntityId, id),
            isNull(complianceDocuments.supersededById)
          )
        )
        .orderBy(desc(complianceDocuments.createdAt));
    });
    if (rows === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      documents: rows.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        description: d.description,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        tags: d.tags ?? [],
        clientUploaded: Array.isArray(d.tags) && (d.tags as string[]).includes("client_uploaded"),
        createdAt: d.createdAt,
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large - max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB` }, { status: 413 });
    }
    const meta = clientMetaFromHeaders(req.headers);

    // 1. May this person add documents to THIS lead? (404 / 403 otherwise.) Checked
    //    before the file is stored so a refused request leaves nothing behind.
    const lead = await withTenant(session.tenantId, (tx) => loadEditableLead(tx, session, id));

    // 2. Store the file in the document vault.
    const contentType = file.type || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());
    // A renamed executable must not pass for a PDF.
    if (!contentTypeMatches(contentType, buf)) {
      return NextResponse.json({ error: "File content doesn't match its type - it may be renamed or corrupt." }, { status: 400 });
    }
    const firm = await firmFolderName(session.tenantId);
    const key = vaultKey(session.tenantId, "kyc", file.name || "document", {
      firm,
      uploader: session.name,
      client: lead.name,
      docType: "kyc",
    });
    try {
      await putObject(key, buf, contentType);
    } catch (e: any) {
      const detail = e?.name || e?.Code || e?.message || "unknown error";
      return NextResponse.json({ error: `Storage upload failed (${detail}).` }, { status: 502 });
    }

    // 3. File it against the lead.
    const docId = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(complianceDocuments).values({
        id: docId,
        tenantId: session.tenantId,
        category: "kyd",
        name: file.name || "document",
        storageKey: key,
        mimeType: contentType,
        sizeBytes: String(buf.length),
        relatedEntityType: "lead",
        relatedEntityId: id,
        tags: ["lead"],
        uploadedByUserId: session.userId,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "document.upload",
        entityType: "compliance_document",
        entityId: docId,
        after: { name: file.name, leadId: id } as any,
        ...meta,
      });
    });

    return NextResponse.json({ id: docId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const docId = new URL(req.url).searchParams.get("docId");
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      await loadEditableLead(tx, session, id);
      const [doc] = await tx
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.id, docId),
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "lead"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        )
        .limit(1);
      if (!doc) return "not_found" as const;
      if (doc.storageKey) await deleteObject(doc.storageKey).catch(() => {});
      await tx.delete(complianceDocuments).where(eq(complianceDocuments.id, docId));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "document.delete",
        entityType: "compliance_document",
        entityId: docId,
        before: { name: doc.name, leadId: id } as any,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "document not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
