/**
 * GET /api/integrations/zoho/status — non-secret connection + sync status for
 * the Settings UI.
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { getZohoState } from "@/lib/integrations/zoho/credentials";
import { zohoSyncLinks } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const { state, counts } = await withTenant(session.tenantId, async (tx) => {
    const state = await getZohoState(tx, session.tenantId);
    const counts = await tx
      .select({ status: zohoSyncLinks.status, n: sql<number>`count(*)::int` })
      .from(zohoSyncLinks)
      .where(eq(zohoSyncLinks.tenantId, session.tenantId))
      .groupBy(zohoSyncLinks.status);
    return { state, counts };
  });
  const byStatus: Record<string, number> = {};
  for (const c of counts as any[]) byStatus[c.status] = Number(c.n);
  return NextResponse.json({
    ...state,
    counts: { synced: byStatus.synced ?? 0, error: byStatus.error ?? 0, pending: byStatus.pending ?? 0 },
  });
}
