/**
 * GET  /api/reports/metric-status?metric=<key>&period=YYYY-MM
 *      → assembled branch-wise metric status (branch value pre-filled live +
 *        editable; targets + external sources carried forward; prior-month
 *        figures for the month-on-month column)
 * POST /api/reports/metric-status
 *      Body: { metric, period, rows: [{ sourceType, branchId?, name, value, target? }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadMetricStatus, saveMetricStatus, currentPeriod } from "@/lib/finance/metric-status";
import { isMetricKey } from "@/lib/finance/metric-config";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const metric = req.nextUrl.searchParams.get("metric") ?? "";
    if (!isMetricKey(metric)) {
      return NextResponse.json({ error: "unknown metric" }, { status: 400 });
    }
    const raw = req.nextUrl.searchParams.get("period") ?? "";
    const period = PERIOD_RE.test(raw) ? raw : currentPeriod();
    const data = await withTenant(session.tenantId, async (tx) => loadMetricStatus(tx, metric, period));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  metric: z.string().refine(isMetricKey, "unknown metric"),
  period: z.string().regex(PERIOD_RE),
  rows: z
    .array(
      z.object({
        sourceType: z.enum(["branch", "external"]),
        branchId: z.string().uuid().nullable().optional(),
        name: z.string().trim().max(160),
        value: z.number().min(0).max(1_000_000_000),
        target: z.number().min(0).max(1_000_000_000).nullable().optional(),
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
    const { metric, period, rows } = parsed.data;
    if (!isMetricKey(metric)) return NextResponse.json({ error: "unknown metric" }, { status: 400 });

    const data = await withTenant(session.tenantId, async (tx) => {
      await saveMetricStatus(tx, session.tenantId, metric, period, rows);
      return loadMetricStatus(tx, metric, period);
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
