/**
 * GET /api/reports/insurance-production?advisor=<uuid>&fy=YYYY-YY
 *   → { advisors, production } — per-advisor insurance production (Personal +
 *     Commercial lines, New/Renewal), computed live.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { listAdvisors, loadAdvisorProduction, currentFiscalYear } from "@/lib/insurance/advisor-production";

export const dynamic = "force-dynamic";

const FY_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const raw = req.nextUrl.searchParams.get("fy") ?? "";
    const fy = FY_RE.test(raw) ? raw : currentFiscalYear();
    const advisorParam = req.nextUrl.searchParams.get("advisor") ?? "";

    const data = await withTenant(session.tenantId, async (tx) => {
      const advisors = await listAdvisors(tx);
      if (advisors.length === 0) return { advisors: [], production: null };
      const advisorId = advisorParam && advisors.some((a) => a.id === advisorParam) ? advisorParam : advisors[0].id;
      const production = await loadAdvisorProduction(tx, advisorId, fy);
      return { advisors, production };
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
