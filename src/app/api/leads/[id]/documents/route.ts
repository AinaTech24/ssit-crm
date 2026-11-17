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
 * Upload flow: browser -> POST /api/compliance/upload (stores the file, returns a
 * storage key) -> POST here with that key.
 *
 * Who may: viewing needs document.view AND the lead inside the caller's data wall;
 * adding / removing needs document.upload AND the right to edit that lead.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { complianceDocuments } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadEditableLead, loadViewableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  storageKey: z.string().min(1).max(500),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.view", session.permissions);
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const docId = uuid();
    await withTenant(session.tenantId, async (tx) => {
      // Throws 404 / 403 when the lead is missing or outside this person's wall.
      await loadEditableLead(tx, session, id);

      await tx.insert(complianceDocuments).values({
        id: docId,
        tenantId: session.tenantId,
        category: "kyd",
        name: b.name,
        description: b.description ?? null,
        storageKey: b.storageKey,
        mimeType: b.mimeType ?? null,
        sizeBytes: b.sizeBytes != null ? String(b.sizeBytes) : null,
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
        after: { name: b.name, leadId: id } as any,
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
    requireCap(session.roles, "document.upload", session.permissions);
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
