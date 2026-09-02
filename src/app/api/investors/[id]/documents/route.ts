import { handleApiError } from "@/lib/api/error-handler";
/**
 * Client (investor) documents.
 *
 *   GET    /api/investors/[id]/documents          — list this client's documents
 *   POST   /api/investors/[id]/documents          — register an uploaded file
 *   DELETE /api/investors/[id]/documents?docId=…   — remove a document
 *
 * Backed by the shared `compliance_documents` table (relatedEntityType='investor',
 * relatedEntityId=<investor>). Required-document uploads from the public form
 * already land here with the same linkage, so they surface automatically. RM-
 * gated (document.view / document.upload) rather than compliance-only, so the
 * relationship manager can manage their client's files.
 *
 * Upload flow: client → POST /api/compliance/upload-url (presigned PUT) → S3 PUT
 * → POST here with the returned storageKey.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments, investors } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DOC_CATEGORIES = [
  "arn", "euin", "nism", "kyd", "amc_empanelment", "ddq", "sop",
  "complaint", "marketing_approval", "audit_report", "ria_compliance", "other",
] as const;

const CreateBody = z.object({
  name: z.string().min(1).max(300),
  category: z.enum(DOC_CATEGORIES).default("kyd"),
  description: z.string().max(1000).optional(),
  storageKey: z.string().min(1).max(500),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.view", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "investor"),
            eq(complianceDocuments.relatedEntityId, id),
            isNull(complianceDocuments.supersededById)
          )
        )
        .orderBy(desc(complianceDocuments.createdAt))
    );
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
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const docId = uuid();
    const outcome = await withTenant(session.tenantId, async (tx) => {
      // The client must be in this firm (the storageKey was already tenant-scoped).
      const [inv] = await tx
        .select({ id: investors.id })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return "no_client" as const;

      await tx.insert(complianceDocuments).values({
        id: docId,
        tenantId: session.tenantId,
        category: b.category,
        name: b.name,
        description: b.description ?? null,
        storageKey: b.storageKey,
        mimeType: b.mimeType ?? null,
        sizeBytes: b.sizeBytes != null ? String(b.sizeBytes) : null,
        relatedEntityType: "investor",
        relatedEntityId: id,
        tags: ["client", ...(b.tags ?? [])],
        uploadedByUserId: session.userId,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "document.upload",
        entityType: "compliance_document",
        entityId: docId,
        after: { name: b.name, category: b.category, investorId: id } as any,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "no_client") return NextResponse.json({ error: "client not found" }, { status: 404 });
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
    const docId = new URL(req.url).searchParams.get("docId");
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.id, docId),
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "investor"),
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
        before: { name: doc.name, investorId: id } as any,
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
