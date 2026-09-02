/**
 * GET  /api/reports/sif-status?fy=YYYY-YY  → SIF Target-vs-Actual roll-up
 * POST /api/reports/sif-status              → save targets
 *      Body: { fiscalYear, targets: [{ scopeType: 'branch'|'desk', scopeId, target }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadSifStatus, saveSifTargets, currentFiscalYear } from "@/lib/business/sif-status";

export const dynamic = "force-dynamic";

const FY_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const raw = req.nextUrl.searchParams.get("fy") ?? "";
    const fy = FY_RE.test(raw) ? raw : currentFiscalYear();
    const data = await withTenant(session.tenantId, async (tx) => loadSifStatus(tx, fy));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  fiscalYear: z.string().regex(FY_RE),
  targets: z
    .array(
      z.object({
        scopeType: z.enum(["branch", "desk"]),
        scopeId: z.string().uuid(),
        target: z.number().min(0).max(1e15),
      })
    )
    .max(500),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { fiscalYear, targets } = parsed.data;
    const data = await withTenant(session.tenantId, async (tx) => {
      await saveSifTargets(tx, session.tenantId, fiscalYear, targets);
      return loadSifStatus(tx, fiscalYear);
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
