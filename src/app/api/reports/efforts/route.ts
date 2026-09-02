/**
 * GET  /api/reports/efforts?period=YYYY-MM → Plan vs Actual efforts (+ computed suggestions)
 * POST /api/reports/efforts                → save { period, entries: [{ metricKey, planned, actual }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadEfforts, saveEfforts } from "@/lib/finance/efforts";

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
    const data = await withTenant(session.tenantId, async (tx) => loadEfforts(tx, period));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  period: z.string().regex(PERIOD_RE),
  entries: z
    .array(z.object({ metricKey: z.string().max(40), planned: z.number().min(0).max(1e9), actual: z.number().min(0).max(1e9) }))
    .max(50),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const data = await withTenant(session.tenantId, async (tx) => {
      await saveEfforts(tx, session.tenantId, parsed.data.period, parsed.data.entries);
      return loadEfforts(tx, parsed.data.period);
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
