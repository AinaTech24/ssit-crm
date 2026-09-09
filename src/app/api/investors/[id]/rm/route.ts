import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/rm — who owns and who services this client.
 *
 * A deliberately tiny endpoint. Forms that pick a client and then need to SHOW
 * the responsible RM (client engagement, gift logging) were otherwise pulling
 * the full investor record — folios, SIPs, goals, comms, tasks and tickets —
 * to read two names off it.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, users } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const out = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({
          id: investors.id,
          name: investors.name,
          rmId: investors.rmId,
          serviceRmId: investors.serviceRmId,
          branchId: investors.branchId,
        })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;

      // Same visibility rule the client record itself uses — this endpoint must
      // not become a way to enumerate other people's books.
      await assertCanViewClient(tx, session, inv);

      const ids = [inv.rmId, inv.serviceRmId].filter(Boolean) as string[];
      const names = ids.length
        ? await tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(and(eq(users.tenantId, session.tenantId), inArray(users.id, ids)))
        : [];
      const nameOf = (uid: string | null) => (uid ? (names.find((n) => n.id === uid)?.name ?? null) : null);

      return {
        investorId: inv.id,
        clientName: inv.name,
        rmId: inv.rmId,
        rmName: nameOf(inv.rmId),
        serviceRmId: inv.serviceRmId,
        serviceRmName: nameOf(inv.serviceRmId),
      };
    });

    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err: any) {
    return handleApiError(err);
  }
}
