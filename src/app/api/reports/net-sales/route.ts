/**
 * GET /api/reports/net-sales?product=<type|__all__>&period=YYYY-MM
 *   → Gross/Redemption/Net by platform.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadNetSalesMatrix } from "@/lib/business/net-sales-matrix";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-\d{2}$/;

function defaultPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const raw = req.nextUrl.searchParams.get("period") ?? "";
    const period = PERIOD_RE.test(raw) ? raw : defaultPeriod();
    const product = req.nextUrl.searchParams.get("product") || "mutual_fund";
    const data = await withTenant(session.tenantId, async (tx) => loadNetSalesMatrix(tx, product, period));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
