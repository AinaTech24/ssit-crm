import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Internal endpoint used by the `task_weekly_owner_report` recipe.
 *
 * Auth: shared bearer token `INTERNAL_API_TOKEN`.
 *
 * Body: { tenantId: string, weekStart?: ISOString }
 *
 * Returns a rolled-up snapshot of the firm's open task pipeline:
 *   - open_total / overdue_count / sla_at_risk / completed_last_week
 *   - by_department: { sales: 12, operations: 4, … }
 *   - by_rm: [{ rm_id, rm_name, open_count }]  (top 5)
 *   - wow_delta: % change vs previous week's open count
 *   - avg_age_days: mean (now - created_at) over open tasks
 *   - week_start / week_end: ISO date strings for display
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; weekStart?: string };
  if (!body.tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const weekStart = body.weekStart ? new Date(body.weekStart) : startOfWeek(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const out = await withSystem(async (tx) => {
    // Top-line counters
    const counters = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open_total,
        COUNT(*) FILTER (
          WHERE status IN ('open','in_progress') AND due_at < now()
        )::int AS overdue_count,
        COUNT(*) FILTER (
          WHERE status IN ('open','in_progress')
            AND sla_due_at IS NOT NULL
            AND sla_due_at >= now()
            AND sla_due_at < now() + interval '24 hours'
        )::int AS sla_at_risk,
        COUNT(*) FILTER (
          WHERE status = 'completed'
            AND completed_at >= ${weekStart.toISOString()}::timestamptz - interval '7 days'
            AND completed_at < ${weekStart.toISOString()}::timestamptz
        )::int AS completed_last_week,
        COALESCE(ROUND(AVG(EXTRACT(DAY FROM (now() - created_at)))
          FILTER (WHERE status IN ('open','in_progress')), 1), 0) AS avg_age_days
      FROM tasks
      WHERE tenant_id = ${body.tenantId}::uuid
    `);
    const c = counters.rows[0] as any;

    // By department
    const byDept = await tx.execute(sql`
      SELECT COALESCE(department, 'other') AS department, COUNT(*)::int AS n
      FROM tasks
      WHERE tenant_id = ${body.tenantId}::uuid
        AND status IN ('open','in_progress')
      GROUP BY 1
      ORDER BY n DESC
    `);

    // Top 5 RMs by backlog
    const byRm = await tx.execute(sql`
      SELECT t.assignee_id AS rm_id, u.name AS rm_name, COUNT(*)::int AS open_count
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.tenant_id = ${body.tenantId}::uuid
        AND t.status IN ('open','in_progress')
        AND t.assignee_id IS NOT NULL
      GROUP BY t.assignee_id, u.name
      ORDER BY open_count DESC
      LIMIT 5
    `);

    // Week-over-week delta on open count
    const previous = await tx.execute(sql`
      SELECT COUNT(*)::int AS prev_open
      FROM tasks
      WHERE tenant_id = ${body.tenantId}::uuid
        AND status IN ('open','in_progress')
        AND created_at < ${weekStart.toISOString()}::timestamptz - interval '7 days'
    `);
    const prevOpen = Number((previous.rows[0] as any)?.prev_open ?? 0);

    return {
      week_start: weekStart.toISOString().slice(0, 10),
      week_end: weekEnd.toISOString().slice(0, 10),
      open_total: Number(c?.open_total ?? 0),
      overdue_count: Number(c?.overdue_count ?? 0),
      sla_at_risk: Number(c?.sla_at_risk ?? 0),
      completed_last_week: Number(c?.completed_last_week ?? 0),
      avg_age_days: Number(c?.avg_age_days ?? 0),
      by_department: Object.fromEntries(byDept.rows.map((r: any) => [r.department, Number(r.n)])),
      by_rm: byRm.rows.map((r: any) => ({
        rm_id: r.rm_id,
        rm_name: r.rm_name ?? "(unassigned)",
        open_count: Number(r.open_count),
      })),
      wow_delta_pct: prevOpen > 0 ? Math.round(((Number(c?.open_total ?? 0) - prevOpen) / prevOpen) * 1000) / 10 : null,
    };
  });

  return NextResponse.json(out);
}

function startOfWeek(d: Date): Date {
  // Monday as start of week
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day + 6) % 7; // days since last Monday
  const m = new Date(d);
  m.setDate(d.getDate() - diff);
  m.setHours(0, 0, 0, 0);
  return m;
}
