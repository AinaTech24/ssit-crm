/**
 * GET /api/risk-profiles/[id]/document
 *
 * Short-lived presigned URL for the signed risk-profile form attached to a
 * profile (the `signature` sign-off route).
 *
 * The handle is the PROFILE ID, never a raw S3 key — the key is read from the
 * tenant-scoped row, so a caller cannot ask us to sign an arbitrary object.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { riskProfileResponses } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Same read gate as the risk-profile list — this is client PII.
    requireAny(
      session.roles,
      ["investor.view.all", "investor.view.assigned"],
      session.permissions
    );

    const key = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select({ documentUrl: riskProfileResponses.documentUrl })
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.id, id))
        .limit(1);
      return row?.documentUrl ?? null;
    });

    if (!key) {
      return NextResponse.json({ error: "no signed form attached" }, { status: 404 });
    }

    const url = await presignedGetUrl(key, 300);
    return NextResponse.json({ url });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}
