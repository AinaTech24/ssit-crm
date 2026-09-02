/**
 * GET /api/reports/equity-team?fy=YYYY-YY&period=YYYY-MM → Equity Team MIS.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadEquityTeam, currentFiscalYear } from "@/lib/equity/service";

export const dynamic = "force-dynamic";

const FY_RE = /^\d{4}-\d{2}$/;
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
    const fyRaw = req.nextUrl.searchParams.get("fy") ?? "";
    const fy = FY_RE.test(fyRaw) ? fyRaw : currentFiscalYear();
    const pRaw = req.nextUrl.searchParams.get("period") ?? "";
    const period = PERIOD_RE.test(pRaw) ? pRaw : defaultPeriod();
    const data = await withTenant(session.tenantId, async (tx) => loadEquityTeam(tx, fy, period));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
