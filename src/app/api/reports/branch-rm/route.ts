/**
 * GET /api/reports/branch-rm?kind=<key>&branch=<uuid>&period=YYYY-MM
 *   → { branches, matrix } — branch + RM-wise business matrix for the kind,
 *     computed live from Business Entries / Insurance. If no branch is given,
 *     defaults to the first branch.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { listBranches, loadRmMatrix } from "@/lib/business/rm-matrix";
import { isRmMatrixKey } from "@/lib/business/rm-matrix-config";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-\d{2}$/;

function currentPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1); // default: last closed month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const kind = req.nextUrl.searchParams.get("kind") ?? "";
    if (!isRmMatrixKey(kind)) {
      return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    }
    const rawPeriod = req.nextUrl.searchParams.get("period") ?? "";
    const period = PERIOD_RE.test(rawPeriod) ? rawPeriod : currentPeriod();
    const branchParam = req.nextUrl.searchParams.get("branch") ?? "";

    const data = await withTenant(session.tenantId, async (tx) => {
      const branchList = await listBranches(tx);
      if (branchList.length === 0) return { branches: [], matrix: null };
      const branchId =
        branchParam && branchList.some((b) => b.id === branchParam) ? branchParam : branchList[0].id;
      const matrix = await loadRmMatrix(tx, kind, branchId, period);
      return { branches: branchList, matrix };
    });

    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
