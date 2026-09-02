import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/reconciliation/run
 *   Runs the three-way holdings reconciliation for the current tenant on
 *   demand (the worker also runs it daily). Returns the run summary.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { reconcileHoldings } from "@/lib/reconciliation/engine";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const result = await withTenant(
      session.tenantId,
      async (tx) => reconcileHoldings(tx, session.tenantId),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
