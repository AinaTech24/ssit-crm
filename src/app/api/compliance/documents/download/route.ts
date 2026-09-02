import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
  "image/webp": ".webp", "image/gif": ".gif", "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv", "text/plain": ".txt",
};
/** The document's real name, with an extension appended from its mime when missing. */
function filenameFor(name: string | null, mime: string | null): string {
  let base = (name || "document").trim();
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += EXT_BY_MIME[(mime || "").toLowerCase()] ?? "";
  return base;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same gate as the vault list — compliance + back-office team (owner via can()).
    requireAny(session.roles, ["compliance.view", "kyc.manage"], session.permissions);

    const id = new URL(req.url).searchParams.get("id");
    // inline=1 → view in a browser tab (PDF/image); otherwise download as a file.
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const clientMeta = clientMetaFromHeaders(req.headers);
    const downloadUrl = await withTenant(session.tenantId, async (tx) => {
      const [doc] = await tx
        .select({
          name: complianceDocuments.name,
          storageKey: complianceDocuments.storageKey,
          mimeType: complianceDocuments.mimeType,
          relatedEntityType: complianceDocuments.relatedEntityType,
          relatedEntityId: complianceDocuments.relatedEntityId,
        })
        .from(complianceDocuments)
        .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.tenantId, session.tenantId)))
        .limit(1);

      if (!doc) {
        throw new Error("Document not found or unauthorized access");
      }

      // Audit the access — a compliance vault must be able to answer "who viewed
      // which client's KYC, and when" (DPDP + auditor expectation). inline=1 is a
      // browser preview ("view"); otherwise an "download".
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: inline ? "compliance_document.view" : "compliance_document.download",
        entityType: "compliance_document",
        entityId: id,
        after: { name: doc.name, relatedEntityType: doc.relatedEntityType, relatedEntityId: doc.relatedEntityId } as any,
        ...clientMeta,
      });

      // Generate a presigned S3 URL valid for 10 minutes (600 seconds), naming
      // the file by the document's real name (with the right extension).
      return await presignedGetUrl(doc.storageKey, 600, filenameFor(doc.name, doc.mimeType), inline);
    });

    const redirectUrl = downloadUrl.startsWith("/")
      ? new URL(downloadUrl, req.url).toString()
      : downloadUrl;

    return NextResponse.redirect(redirectUrl);
  } catch (err: any) {
    return handleApiError(err);
  }
}
