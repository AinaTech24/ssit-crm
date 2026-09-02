/**
 * GET /api/portfolio-intelligence[?mine=1] — JSON feed for the mobile Portfolio
 * Intelligence screen. Thin wrapper over getPortfolioIntel() (the exact helper
 * the web RSC uses): book AUM, asset-class + AMC concentration, top holdings,
 * concentration warnings, and concentrated clients. Firm-wide requires
 * dashboard.view.owner; otherwise scoped to the caller's own book.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPortfolioIntel } from "@/lib/portfolio/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const canFirm = can(session.roles, "dashboard.view.owner", session.permissions);
    const mine = req.nextUrl.searchParams.get("mine") === "1" || !canFirm;

    const intel = await withTenant(
      session.tenantId,
      (tx) => getPortfolioIntel(tx as any, { tenantId: session.tenantId, userId: session.userId, firmWide: !mine }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ ...intel, scope: mine ? "mine" : "firm", canFirm });
  } catch (err) {
    return handleApiError(err);
  }
}
