import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/dashboard/custom-chart
 * Body: a CustomChartConfig (subject, chartType, agg, field?, groupBy?, ast?…)
 *
 * Runs the declarative custom component as a parameterised aggregate and returns
 * `{ view, rows, chart }` in the exact shape the WidgetView renderer consumes.
 * Used by both the live preview in the builder and the saved board widgets.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { bindCompiled } from "@/lib/filter/compiler";
import { buildCustomChart, type CustomChartConfig } from "@/lib/dashboards/custom-chart";

export const dynamic = "force-dynamic";

const Body = z.object({
  subject: z.string().min(1).max(40),
  chartType: z.enum(["kpi", "column", "bar", "line", "area", "pie", "donut", "funnel", "table"]),
  agg: z.enum(["count", "count_unique", "sum", "avg", "min", "max"]),
  field: z.string().max(80).optional(),
  groupBy: z.string().max(80).optional(),
  dateGrain: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  ast: z.any().optional(),
  title: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid config", issues: parsed.error.issues }, { status: 400 });
    }

    // Build the aggregate up-front so a bad subject/field/combo is a clean 400.
    let built;
    try {
      built = buildCustomChart(parsed.data as CustomChartConfig, session.tenantId);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Invalid chart configuration." }, { status: 400 });
    }

    const rows = await withTenant(session.tenantId, async (tx) => {
      // Bound the cost of an interactive aggregate so it can't pin a connection.
      await tx.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
      const r = await tx.execute(bindCompiled(built.sql, built.params) as any);
      return r.rows as any[];
    });

    return NextResponse.json({ view: built.view, rows, chart: built.chart });
  } catch (err: any) {
    return handleApiError(err);
  }
}
