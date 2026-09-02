/**
 * Public document-collection presign — POST /api/public/docs/presign.
 *
 * Token-gated: validates the share token (must be a live document_collection
 * link) and returns a presigned S3 PUT URL per file so the client browser
 * uploads each document DIRECTLY to S3 (no large multipart body through our
 * server). The client then calls /api/public/docs/submit with the resulting
 * storage keys. The token is NOT consumed here — only at submit time, atomically.
 *
 * Returned keys are validated server-side again at submit (existence + magic
 * bytes), so a forged key can't smuggle a non-document into the vault.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { shareTokens, leads, investors } from "@/db/schema";
import { presignedPutUrl, vaultKey } from "@/lib/storage/s3";
import { firmFolderName } from "@/lib/storage/firm-folder";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ALLOWED_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export async function POST(req: NextRequest) {
  // 30 presign batches per IP per hour — generous (multi-file forms) but bounded.
  const limited = enforce(req, "public.docs.presign", { limit: 30, windowSec: 60 * 60 });
  if (limited) return limited;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      tokenId?: string;
      files?: Array<{ docKey?: string; filename?: string; contentType?: string }>;
    };
    const tokenId = String(body.tokenId ?? "");
    const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });

    // Validate the token (cross-tenant — no session) without consuming it.
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "document_collection") throw new Error("Not a document-collection token");
      return t;
    });

    const firm = await firmFolderName(tk.tenantId!);
    let clientName: string | null = null;
    await withSystem(async (tx) => {
      if (tk.subjectType === "investor") {
        const [r] = await tx.select({ n: investors.name }).from(investors).where(eq(investors.id, tk.subjectId));
        clientName = r?.n ?? null;
      } else if (tk.subjectType === "lead") {
        const [r] = await tx.select({ n: leads.name }).from(leads).where(eq(leads.id, tk.subjectId));
        clientName = r?.n ?? null;
      }
    });

    const out: Array<{ docKey: string; key: string; url: string }> = [];
    for (const f of files) {
      const contentType = String(f.contentType ?? "");
      if (!ALLOWED_MIMES.has(contentType)) {
        return NextResponse.json({ error: `${f.filename ?? "file"}: only PDF, JPG or PNG allowed` }, { status: 400 });
      }
      const key = vaultKey(tk.tenantId!, "kyc", f.filename || "document", {
        firm,
        uploader: "client-upload",
        client: clientName,
        docType: "kyc",
      });
      const url = await presignedPutUrl(key, contentType, 900);
      out.push({ docKey: String(f.docKey ?? ""), key, url });
    }

    return NextResponse.json({ uploads: out });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
