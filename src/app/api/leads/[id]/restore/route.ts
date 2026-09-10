import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/restore — bring a soft-deleted lead back.
 *
 * Clears deleted_at and the legacy `__deleted__` sentinel together, so the lead
 * reappears in every list regardless of which of the two a given query filters
 * on. The stage is deliberately NOT restored: delete forced it to
 * 'not_qualified' and the pre-delete stage was never recorded, so guessing one
 * would invent history. The lead comes back where the user can see and re-stage
 * it themselves.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leads } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: leads.id, name: leads.name })
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId), isNotNull(leads.deletedAt)))
        .limit(1);
      if (!row) return "not_found" as const;

      await tx
        .update(leads)
        .set({
          deletedAt: null,
          deletedBy: null,
          lostReason: null,
          lostAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.restore",
        entityType: "lead",
        entityId: id,
        after: { name: row.name },
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") {
      return NextResponse.json({ error: "not found in Trash" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
