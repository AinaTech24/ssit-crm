import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/service-requests/[id]/attachments/[attId]/download — stream an
 * attachment through the authenticated proxy so the bucket stays private.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { serviceRequestAttachments } from "@/db/schema";
import { getObjectBytes } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  try {
    const session = await requireSession();
    requireAny(
      session.roles,
      ["service_request.view.all", "service_request.view.assigned", "service_request.manage", "service_request.create"],
      session.permissions
    );
    const att = await withTenant(session.tenantId, async (tx) => {
      const [a] = await tx
        .select()
        .from(serviceRequestAttachments)
        .where(
          and(
            eq(serviceRequestAttachments.id, attId),
            eq(serviceRequestAttachments.serviceRequestId, id),
            eq(serviceRequestAttachments.tenantId, session.tenantId),
            isNull(serviceRequestAttachments.deletedAt)
          )
        )
        .limit(1);
      return a ?? null;
    });
    if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

    const bytes = await getObjectBytes(att.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": att.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(att.fileName)}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
