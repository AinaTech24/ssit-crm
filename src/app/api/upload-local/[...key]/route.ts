import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSession } from "@/lib/auth/session";
import { isS3Configured, getObjectBytes } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Large RTA masters (~25MB) stream through here — give the route headroom.
export const maxDuration = 120;

const ROOT = path.join(process.cwd(), "node-local", "uploads");
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * Local-disk fallback for the S3 document store (used when S3 isn't configured).
 * Keys are `tenants/<tenantId>/<kind>/<ts>-<file>` (see lib/storage/s3.ts vaultKey)
 * or non-tenant admin paths like `library/...`.
 *
 * Access policy (fail-closed): a file is publicly readable ONLY if it's an
 * explicitly public asset class — tenant logos (`general`) and shared marketing
 * assets (`marketing`), which legitimately render on public lead-capture forms
 * and PDFs, plus non-tenant admin `library/` content. Everything else
 * (compliance vault, KYC documents, and any future kind) requires an
 * authenticated session **belonging to the owning tenant**. Writes always
 * require a session and may only target the caller's own tenant namespace.
 */
function safePath(key: string[]): string | null {
  const full = path.resolve(ROOT, key.join("/"));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

/** Public-readable asset classes (logos + shared marketing material). */
const PUBLIC_KINDS = new Set(["general", "marketing"]);

function keyMeta(key: string[]): { tenantId?: string; kind?: string } {
  if (key[0] === "tenants" && key.length >= 3) return { tenantId: key[1], kind: key[2] };
  return {};
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const session = await requireSession(); // must be signed in to store a file
    const { key } = await params;
    const filePath = safePath(key);
    if (!filePath) return NextResponse.json({ error: "bad key" }, { status: 400 });

    // A signed-in user may only write within their OWN tenant's namespace —
    // prevents planting/overwriting files in another firm's key path.
    const { tenantId } = keyMeta(key);
    if (tenantId && tenantId !== session.tenantId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    // Stream the body straight to disk — never buffer the whole file in memory.
    // `req.arrayBuffer()` was truncating large (>~10MB) RTA zips ("End of central
    // directory not found"); streaming the raw body writes the file in full.
    if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
    const ws = fs.createWriteStream(filePath);
    const reader = (req.body as ReadableStream<Uint8Array>).getReader();
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        if (total > MAX_UPLOAD_BYTES) {
          ws.destroy();
          await fs.promises.unlink(filePath).catch(() => {});
          return NextResponse.json({ error: "file too large (max 30MB)" }, { status: 413 });
        }
        if (!ws.write(value)) await new Promise<void>((res) => ws.once("drain", res));
      }
      await new Promise<void>((res, rej) => {
        ws.end(() => res());
        ws.on("error", rej);
      });
    } catch (e) {
      ws.destroy();
      await fs.promises.unlink(filePath).catch(() => {});
      throw e;
    }
    if (total === 0) {
      await fs.promises.unlink(filePath).catch(() => {});
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }
    return NextResponse.json({ success: true, bytes: total });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: status === 401 ? "unauthorized" : "upload failed" }, { status });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const { key } = await params;
    const filePath = safePath(key);
    const { tenantId, kind } = keyMeta(key);

    // Fail-closed: only the explicit public asset classes are served without
    // auth. Tenant docs of any other kind require a same-tenant session.
    const isPublic = !tenantId || (!!kind && PUBLIC_KINDS.has(kind));
    if (!isPublic) {
      let session: Awaited<ReturnType<typeof requireSession>> | null = null;
      try {
        session = await requireSession();
      } catch {
        // Don't reveal existence of protected files to anonymous callers.
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      if (tenantId && session.tenantId !== tenantId) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
    }

    // Serve from local disk if present; otherwise fall back to S3. This makes
    // /api/upload-local/<key> a UNIFIED asset URL that works whether the object
    // lives on the local volume (legacy / no-S3 uploads) or in the S3 bucket
    // (current uploads) — so logos/avatars don't break when storage moves.
    let data: Buffer | null = null;
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      data = await fs.promises.readFile(filePath);
    } else if (isS3Configured()) {
      try {
        const buf = await getObjectBytes(key.join("/"));
        if (buf && buf.length > 0) data = buf;
      } catch {
        data = null;
      }
    }
    if (!data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = path.extname(key.join("/")).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".gif") contentType = "image/gif";
    else if (ext === ".svg") contentType = "image/svg+xml";
    else if (ext === ".pdf") contentType = "application/pdf";
    else if (ext === ".ico") contentType = "image/x-icon";
    else if (ext === ".webp") contentType = "image/webp";

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        // Public assets cache hard; protected docs must never be cached by shared caches.
        "Cache-Control": isPublic
          ? "public, max-age=31536000, immutable"
          : "private, no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
