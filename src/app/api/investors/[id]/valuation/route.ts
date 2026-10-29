import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/valuation
 *   Live portfolio valuation for one investor — current value, net invested,
 *   gain, absolute return, and XIRR, plus a per-scheme breakdown. Values use
 *   the latest AMFI NAV (scheme_nav). See src/lib/finance/valuation.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors } from "@/db/schema";
import { valueInvestor } from "@/lib/finance/valuation";
import { assertInScope } from "@/lib/auth/data-scope";
import { assertCanViewPortfolio } from "@/lib/investors/access";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, branchId: investors.branchId, rmId: investors.rmId, serviceRmId: investors.serviceRmId })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;
      await assertInScope(tx, session, { branchId: inv.branchId, ownerId: [inv.rmId, inv.serviceRmId] }, "client");
      await assertCanViewPortfolio(tx, session, inv);
      return await valueInvestor(tx, id);
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
