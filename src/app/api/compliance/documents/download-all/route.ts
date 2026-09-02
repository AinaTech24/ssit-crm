/**
 * GET /api/compliance/documents/download-all?ids=<id1,id2,…>
 *
 * Bundles the given vault documents into a single ZIP and streams it back.
 * Used by the "Download all" action on a client's document group. Tenant-scoped
 * (only this tenant's docs), capped to keep the in-memory zip bounded.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray, and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { getObjectBytes } from "@/lib/storage/s3";
import { makeZip } from "@/lib/storage/zip";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const MAX_DOCS = 60;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB safety ceiling

/** Pick a file extension from the mime type when the name has none. */
function extFor(mime: string | null): string {
  if (!mime) return "";
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
    "text/plain": ".txt",
  };
  return map[mime] ?? "";
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.view", "kyc.manage"], session.permissions);

    const idsParam = new URL(req.url).searchParams.get("ids") ?? "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_DOCS);
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids required" }, { status: 400 });
    }

    const docs = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select({
          id: complianceDocuments.id,
          name: complianceDocuments.name,
          storageKey: complianceDocuments.storageKey,
          mimeType: complianceDocuments.mimeType,
        })
        .from(complianceDocuments)
        .where(and(inArray(complianceDocuments.id, ids), eq(complianceDocuments.tenantId, session.tenantId)));
    });

    if (docs.length === 0) {
      return NextResponse.json({ error: "No documents found" }, { status: 404 });
    }

    // Fetch each object's bytes; skip any that error (missing key) rather than
    // failing the whole zip. Dedupe names so the archive stays valid.
    const used = new Set<string>();
    const entries: { name: string; data: Buffer }[] = [];
    let total = 0;
    for (const d of docs) {
      let data: Buffer;
      try {
        data = await getObjectBytes(d.storageKey);
      } catch {
        continue; // object not found in storage — skip
      }
      total += data.length;
      if (total > MAX_TOTAL_BYTES) break;

      let base = (d.name || "document").replace(/[/\\:*?"<>|]/g, "_").trim() || "document";
      if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += extFor(d.mimeType);
      let name = base;
      let n = 2;
      while (used.has(name.toLowerCase())) {
        const dot = base.lastIndexOf(".");
        name = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
        n++;
      }
      used.add(name.toLowerCase());
      entries.push({ name, data });
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: "No downloadable files were found in storage." }, { status: 404 });
    }

    // Audit the bulk export — one row capturing the whole ZIP action.
    await withTenant(session.tenantId, async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "compliance_document.download_bulk",
        entityType: "compliance_document",
        entityId: docs[0]?.id ?? "bulk",
        after: { count: entries.length, ids: docs.map((d) => d.id) } as any,
        ...clientMetaFromHeaders(req.headers),
      });
    });

    const zip = makeZip(entries);
    return new NextResponse(zip as any, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="documents-${entries.length}.zip"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
