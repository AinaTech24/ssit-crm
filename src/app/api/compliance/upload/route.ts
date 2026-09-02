import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { putObject, vaultKey, isS3Configured } from "@/lib/storage/s3";
import { contentTypeMatches } from "@/lib/storage/file-sniff";
import { firmFolderName } from "@/lib/storage/firm-folder";
import { handleApiError } from "@/lib/api/error-handler";

/**
 * POST /api/compliance/upload   (multipart/form-data: file, kind?)
 *
 * Server-side proxy upload to the document vault. The browser posts the raw
 * file here and WE put it into S3 (or the local-disk fallback). This is the
 * robust path versus a browser-direct presigned PUT:
 *
 *   - No bucket CORS needed (server→S3 is not a cross-origin browser request).
 *   - No signed-header replay (the SDK sends SSE/Content-Type itself).
 *   - One round-trip instead of presign → PUT → register.
 *
 * Returns { key } which the caller then registers via POST
 * /api/compliance/documents. Capped to keep the request bounded; large media
 * should still use the presigned flow once bucket CORS is configured.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const KINDS = new Set(["compliance", "kyc", "marketing", "general"]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "file is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large — max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB` },
        { status: 413 }
      );
    }

    const kindRaw = String(form.get("kind") ?? "compliance");
    const kind = (KINDS.has(kindRaw) ? kindRaw : "compliance") as
      | "compliance"
      | "kyc"
      | "marketing"
      | "general";

    // Optional readable-tree context: who the file is for + what it is. When
    // present we lay the object out as firm/<firm>/<uploader>/<client>/<docType>/…
    const clientName = form.get("clientName") ? String(form.get("clientName")) : null;
    const docType = form.get("docType") ? String(form.get("docType")) : null;
    const firm = await firmFolderName(session.tenantId);
    const key = vaultKey(session.tenantId, kind, file.name || "document", {
      firm,
      uploader: session.name,
      client: clientName,
      docType: docType ?? kind,
    });
    const contentType = file.type || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());

    // Verify the declared content-type against the file's real magic bytes — a
    // renamed executable shouldn't be able to masquerade as a PDF in the vault.
    if (!contentTypeMatches(contentType, buf)) {
      return NextResponse.json({ error: "File content doesn't match its type — it may be renamed or corrupt." }, { status: 400 });
    }

    try {
      await putObject(key, buf, contentType);
    } catch (e: any) {
      // Surface a storage-specific message so a misconfigured bucket / bad key
      // is diagnosable from the UI instead of a generic 500.
      const detail = e?.name || e?.Code || e?.message || "unknown error";
      return NextResponse.json(
        {
          error: isS3Configured()
            ? `Storage upload failed (${detail}). Check S3 bucket/region and IAM s3:PutObject permission.`
            : `Local storage write failed (${detail}).`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ key, contentType, sizeBytes: buf.length, storage: isS3Configured() ? "s3" : "local" });
  } catch (err) {
    return handleApiError(err);
  }
}
