/**
 * POST /api/employees/[id]/restore
 *   Bring a trashed (soft-deleted) employee back — clears deleted_at/deleted_by
 *   so the record reappears in the team list and can sign in again. Their prior
 *   status (active/suspended/…) is left untouched; sessions were revoked at
 *   trash time, so they simply log in fresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { clearSessionRevocationCache } from "@/lib/auth/revocation";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)));
      if (!existing) return null;
      if (!existing.deletedAt) return { user: existing, alreadyLive: true };

      const [next] = await tx
        .update(users)
        .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.tenantId, session.tenantId)))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.restore",
        entityType: "user",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return { user: next };
    });

    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    clearSessionRevocationCache(id);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
