import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/documents/download?docId=…
 *
 * Returns a short-lived presigned S3 GET URL for one of the client's documents.
 * Verifies the document belongs to this tenant + this investor before signing.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
  "image/webp": ".webp", "image/gif": ".gif", "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv", "text/plain": ".txt",
};
function filenameFor(name: string | null, mime: string | null): string {
  let base = (name || "document").trim();
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += EXT_BY_MIME[(mime || "").toLowerCase()] ?? "";
  return base;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.view", session.permissions);
    const sp = new URL(req.url).searchParams;
    const docId = sp.get("docId");
    const inline = sp.get("inline") === "1";
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

    const doc = await withTenant(session.tenantId, async (tx) => {
      const [d] = await tx
        .select({ storageKey: complianceDocuments.storageKey, name: complianceDocuments.name, mimeType: complianceDocuments.mimeType })
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
      if (!d) return null;
      // Audit access to a client's document (who viewed which KYC, when).
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: inline ? "document.view" : "document.download",
        entityType: "compliance_document",
        entityId: docId,
        after: { name: d.name, investorId: id } as any,
        ...clientMetaFromHeaders(req.headers),
      });
      return d;
    });

    if (!doc || !doc.storageKey) return NextResponse.json({ error: "document not found" }, { status: 404 });
    const url = await presignedGetUrl(doc.storageKey, 600, filenameFor(doc.name, doc.mimeType), inline);
    return NextResponse.json({ url });
  } catch (err: any) {
    return handleApiError(err);
  }
}
