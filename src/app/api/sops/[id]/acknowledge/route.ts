import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { sops, sopAcknowledgements } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // 1. Fetch SOP and its current version
      // Tenant predicate — a foreign SOP id must not be acknowledgeable.
      const [sop] = await tx
        .select({
          id: sops.id,
          currentVersionId: sops.currentVersionId,
          title: sops.title,
        })
        .from(sops)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId)))
        .limit(1);

      if (!sop) {
        throw new Error("SOP not found");
      }

      if (!sop.currentVersionId) {
        throw new Error("No active version published for this SOP");
      }

      // 2. Insert the acknowledgement idempotently — the (sop_version_id, user_id)
      //    unique index makes a double-click / race a no-op (an empty `returning`),
      //    so duplicate acks can't inflate the DDQ sign-off-coverage score.
      const inserted = await tx
        .insert(sopAcknowledgements)
        .values({
          tenantId: session.tenantId,
          sopVersionId: sop.currentVersionId,
          userId: session.userId,
        } as any)
        .onConflictDoNothing({
          target: [sopAcknowledgements.sopVersionId, sopAcknowledgements.userId],
        })
        .returning();

      if (inserted.length === 0) {
        return { alreadyAcknowledged: true };
      }
      const ack = inserted[0];

      // 4. Record audit log
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sop.acknowledge",
        entityType: "sop",
        entityId: id,
        after: {
          sopVersionId: sop.currentVersionId,
          sopTitle: sop.title,
        } as any,
        ...meta,
      });

      return { success: true, id: ack.id };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
