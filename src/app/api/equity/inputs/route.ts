/**
 * POST /api/equity/inputs → save the Equity Team planned targets + this-month
 * brokerage in one call.
 *   Body: { fiscalYear, period, targets?: { brokerage?, newDmat?, activeClients? },
 *           brokerage?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { setBrokerage, setEquityTarget, loadEquityTeam } from "@/lib/equity/service";

export const dynamic = "force-dynamic";

const Body = z.object({
  fiscalYear: z.string().regex(/^\d{4}-\d{2}$/),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  targets: z
    .object({
      brokerage: z.number().min(0).max(1e15).optional(),
      newDmat: z.number().min(0).max(1e9).optional(),
      activeClients: z.number().min(0).max(1e9).optional(),
    })
    .optional(),
  brokerage: z.number().min(0).max(1e15).optional(),
});

const METRIC = { brokerage: "equity_brokerage", newDmat: "equity_new_dmat", activeClients: "equity_active_clients" };

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Firm-level brokerage + targets — gate to managers (matches the read side
    // in /api/reports/equity-team), not any logged-in user.
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const { fiscalYear, period, targets, brokerage } = parsed.data;

    const data = await withTenant(session.tenantId, async (tx) => {
      if (targets) {
        if (targets.brokerage != null) await setEquityTarget(tx, session.tenantId, fiscalYear, METRIC.brokerage, targets.brokerage);
        if (targets.newDmat != null) await setEquityTarget(tx, session.tenantId, fiscalYear, METRIC.newDmat, targets.newDmat);
        if (targets.activeClients != null) await setEquityTarget(tx, session.tenantId, fiscalYear, METRIC.activeClients, targets.activeClients);
      }
      if (brokerage != null) await setBrokerage(tx, session.tenantId, period, brokerage);
      return loadEquityTeam(tx, fiscalYear, period);
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
