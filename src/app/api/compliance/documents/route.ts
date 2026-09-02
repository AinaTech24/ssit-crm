import { handleApiError } from "@/lib/api/error-handler";
/**
 * Compliance documents collection.
 *
 *   GET  /api/compliance/documents
 *   POST /api/compliance/documents          — register an uploaded doc (after presigned PUT)
 *   DELETE /api/compliance/documents?id=...  — remove a saved doc from S3 and DB
 *
 * Upload flow:
 *   1. Client POSTs metadata to /upload-url to get a presigned PUT
 *   2. Client uploads file directly to S3 with that URL
 *   3. Client POSTs the storage key + metadata here to register it
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, sql, eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  category: z.enum([
    "arn",
    "euin",
    "nism",
    "kyd",
    "amc_empanelment",
    "ddq",
    "sop",
    "complaint",
    "marketing_approval",
    "audit_report",
    "ria_compliance",
    "other",
  ]),
  name: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  storageKey: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  issuedOn: z.string().optional(),
  expiresOn: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    // The compliance vault holds DDQ, audit reports, complaints, empanelment
    // and RIA docs — restrict reads to the compliance + back-office team
    // (owner wins via can()). Previously any authenticated session could list it.
    requireAny(session.roles, ["compliance.view", "kyc.manage"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(complianceDocuments)
        .where(isNull(complianceDocuments.supersededById))
        .orderBy(desc(complianceDocuments.createdAt));
    });
    return NextResponse.json({ documents: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const id = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(complianceDocuments).values({
        id,
        tenantId: session.tenantId,
        category: body.category,
        name: body.name,
        description: body.description,
        storageKey: body.storageKey,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes ? String(body.sizeBytes) : undefined,
        issuedOn: body.issuedOn || null,
        expiresOn: body.expiresOn || null,
        relatedEntityType: body.relatedEntityType,
        relatedEntityId: body.relatedEntityId,
        tags: body.tags ?? [],
        uploadedByUserId: session.userId,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions); // gated by compliance settings management

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const meta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(complianceDocuments)
        .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.tenantId, session.tenantId)))
        .limit(1);

      if (!doc) {
        throw new Error("Document not found");
      }

      // Delete from S3 storage if storageKey exists
      if (doc.storageKey) {
        await deleteObject(doc.storageKey);
      }

      // Delete from database
      await tx
        .delete(complianceDocuments)
        .where(eq(complianceDocuments.id, id));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "compliance_document.delete",
        entityType: "compliance_document",
        entityId: id,
        before: doc as any,
        ...meta,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
