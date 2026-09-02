import { handleApiError } from "@/lib/api/error-handler";
/**
 * Per-client gifts — single-gift endpoint.
 *
 *   DELETE /api/investors/[id]/gifts/[giftId]   — remove a gift
 *
 * Raw SQL inside withTenant(); RLS scopes by app.tenant_id and we filter by
 * tenant_id + investor_id + id as defence-in-depth.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> }
) {
  const { id, giftId } = await params;
  try {
    const session = await requireSession();
    // Client-linked write — same bar as editing the client record itself.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    await withTenant(session.tenantId, async (tx) => {
      await tx.execute(sql`
        DELETE FROM client_gifts
        WHERE id = ${giftId}::uuid
          AND investor_id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
      `);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
