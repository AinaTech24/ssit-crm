import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/capital-gains?fy=2024
 *   Realized STCG/LTCG for the financial year (FIFO lot matching). fy = the
 *   starting calendar year (2024 ⇒ FY2024-25). Defaults to the current FY.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors } from "@/db/schema";
import { computeRealizedGains, currentFyStartYear } from "@/lib/tax/realized-gains";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const fyParam = Number(req.nextUrl.searchParams.get("fy"));
    const fy = Number.isInteger(fyParam) && fyParam > 2000 ? fyParam : currentFyStartYear();

    const result = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;
      return computeRealizedGains(tx, id, fy);
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
