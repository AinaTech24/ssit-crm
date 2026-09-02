import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/compliance/documents/[id]/supersede
 *
 * Replace a document with a newer version (e.g. a renewed ARN). Registers the
 * new uploaded file as a fresh row (version = old + 1, inheriting the old doc's
 * client linkage + category unless overridden) and marks the OLD row superseded
 * so it drops out of the vault but stays for history/audit.
 *
 * Flow: upload the new file via /api/compliance/upload (or presigned PUT) to get
 * a storageKey, then POST it here.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(300).optional(),
  storageKey: z.string().min(1).max(500),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  issuedOn: z.string().optional(),
  expiresOn: z.string().optional(),
  description: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const newId = uuid();

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [old] = await tx
        .select()
        .from(complianceDocuments)
        .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.tenantId, session.tenantId)))
        .limit(1);
      if (!old) return "not_found" as const;
      if (old.supersededById) return "already_superseded" as const;

      await tx.insert(complianceDocuments).values({
        id: newId,
        tenantId: session.tenantId,
        category: old.category,
        name: b.name ?? old.name,
        description: b.description ?? old.description,
        storageKey: b.storageKey,
        mimeType: b.mimeType ?? old.mimeType,
        sizeBytes: b.sizeBytes != null ? String(b.sizeBytes) : old.sizeBytes,
        issuedOn: b.issuedOn || null,
        expiresOn: b.expiresOn || null,
        relatedEntityType: old.relatedEntityType,
        relatedEntityId: old.relatedEntityId,
        tags: old.tags ?? [],
        uploadedByUserId: session.userId,
        version: (old.version ?? 1) + 1,
      } as any);

      // Point the old row at the new version so the vault hides it.
      await tx
        .update(complianceDocuments)
        .set({ supersededById: newId, updatedAt: new Date() } as any)
        .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "compliance_document.supersede",
        entityType: "compliance_document",
        entityId: newId,
        before: { id: old.id, name: old.name, version: old.version } as any,
        after: { id: newId, name: b.name ?? old.name, version: (old.version ?? 1) + 1 } as any,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "document not found" }, { status: 404 });
    if (outcome === "already_superseded") return NextResponse.json({ error: "this document was already replaced" }, { status: 409 });
    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
