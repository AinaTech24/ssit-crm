import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/compliance/upload-url
 * Body: { filename, contentType, kind?: 'compliance'|'kyc'|'marketing'|'general' }
 *
 * Returns a presigned S3 PUT URL the browser uses to upload directly.
 * After upload, client calls POST /api/compliance/documents with the key to register it.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { presignedPutUrl, vaultKey } from "@/lib/storage/s3";
import { firmFolderName } from "@/lib/storage/firm-folder";

export const dynamic = "force-dynamic";

const Body = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
  kind: z.enum(["compliance", "kyc", "marketing", "general"]).default("compliance"),
  // Optional readable-tree context. docType "logo" → firm/<firm>/logos/…
  clientName: z.string().max(200).optional(),
  docType: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const firm = await firmFolderName(session.tenantId);
    const key = vaultKey(session.tenantId, parse.data.kind, parse.data.filename, {
      firm,
      uploader: session.name,
      client: parse.data.clientName ?? null,
      docType: parse.data.docType ?? parse.data.kind,
    });
    const url = await presignedPutUrl(key, parse.data.contentType, 600);
    return NextResponse.json({ url, key });
  } catch (err: any) {
    return handleApiError(err);
  }
}
