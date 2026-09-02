/**
 * GET /api/reports/insurance-claims?period=YYYY-MM&branch=<uuid>
 *   → claims summary (logged / settled / pending / file-not-received).
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadClaimsSummary } from "@/lib/insurance/claims-summary";
import { listBranches } from "@/lib/business/rm-matrix";

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
    const branch = req.nextUrl.searchParams.get("branch") || null;

    const data = await withTenant(session.tenantId, async (tx) => {
      const branches = await listBranches(tx);
      const summary = await loadClaimsSummary(tx, period, branch);
      return { branches, ...summary };
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
