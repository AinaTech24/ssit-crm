import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/kb/image/[id]?i=<index> — a Knowledge Base screenshot.
 *
 * PUBLIC: the Knowledge Base is open, so screenshots need no session. The
 * storage key is still looked up server-side from the article's own
 * `screenshots` array (never trusted from the query string) and only for a
 * PUBLISHED article, then 302'd to a short-lived presigned URL — so the S3
 * bucket itself stays private and nothing else in it is reachable.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { kbArticles, type KbScreenshot } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const idx = Number(req.nextUrl.searchParams.get("i") ?? "0");
    if (!Number.isInteger(idx) || idx < 0 || idx > 50) {
      return NextResponse.json({ error: "bad index" }, { status: 400 });
    }

    const row = await withSystem(async (tx) => {
      const [r] = await tx
        .select({ screenshots: kbArticles.screenshots })
        .from(kbArticles)
        .where(and(eq(kbArticles.id, id), eq(kbArticles.published, true)))
        .limit(1);
      return r ?? null;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    const shots: KbScreenshot[] = Array.isArray(row.screenshots) ? row.screenshots : [];
    const shot = shots[idx];
    if (!shot?.storageKey) return NextResponse.json({ error: "not found" }, { status: 404 });

    const url = await presignedGetUrl(shot.storageKey, 600, undefined, true);
    // 302 rather than streaming — storage serves the bytes, we only authorise.
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    return handleApiError(err);
  }
}
