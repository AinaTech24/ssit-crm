import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Internal endpoint used by the `task_daily_summary` recipe.
 *
 * Auth: shared bearer token `INTERNAL_API_TOKEN` (set in env). Workers/recipes
 * call this from inside the cluster — not user-facing.
 *
 * Body:
 *   { tenantId: string, userId: string, buckets: ("overdue"|"due_today"|"upcoming_7d")[] }
 *
 * Returns:
 *   { total, overdue_count, due_today_count, upcoming_count,
 *     overdue: Task[], due_today: Task[], upcoming: Task[] }
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    tenantId?: string;
    userId?: string;
    buckets?: string[];
  };
  if (!body.tenantId || !body.userId) {
    return NextResponse.json({ error: "tenantId and userId required" }, { status: 400 });
  }
  const wanted = new Set(body.buckets ?? ["overdue", "due_today", "upcoming_7d"]);

  const rows = await withSystem(async (tx) => {
    const all = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        status: tasks.status,
        type: tasks.type,
        department: tasks.department,
        dueAt: tasks.dueAt,
        slaDueAt: tasks.slaDueAt,
        relatedInvestorId: tasks.relatedInvestorId,
        relatedLeadId: tasks.relatedLeadId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, body.tenantId!),
          eq(tasks.assigneeId, body.userId!),
          isNull(tasks.deletedAt),
          inArray(tasks.status, ["open", "in_progress"] as any),
          isNotNull(tasks.dueAt)
        )
      )
      .orderBy(asc(tasks.dueAt))
      .limit(200);
    return all;
  });

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);
  const in7Days = new Date(now + 7 * 24 * 60 * 60 * 1000);

  const overdue: any[] = [];
  const due_today: any[] = [];
  const upcoming: any[] = [];
  for (const r of rows) {
    const d = r.dueAt ? new Date(r.dueAt as any) : null;
    if (!d) continue;
    if (d < startOfToday) overdue.push(r);
    else if (d <= endOfToday) due_today.push(r);
    else if (d <= in7Days) upcoming.push(r);
  }

  return NextResponse.json({
    total: overdue.length + due_today.length + upcoming.length,
    overdue_count: overdue.length,
    due_today_count: due_today.length,
    upcoming_count: upcoming.length,
    overdue: wanted.has("overdue") ? overdue.slice(0, 30) : [],
    due_today: wanted.has("due_today") ? due_today.slice(0, 30) : [],
    upcoming: wanted.has("upcoming_7d") ? upcoming.slice(0, 30) : [],
  });
}
