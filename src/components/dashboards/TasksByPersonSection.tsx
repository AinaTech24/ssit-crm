/**
 * Tasks, person by person — the same table style as "Meetings & portfolio
 * reviews by RM", on every dashboard.
 *
 * Who is listed follows the task data wall, not a role label: the owner (and back
 * office / ops) see everyone's tasks, a sub-branch head sees the people on their
 * desk, an RM sees only their own row. The wall is applied to the ASSIGNEE of each
 * task, so a head who created a task for someone outside their desk does not
 * thereby get that person's whole workload.
 *
 * "Other activity" items (bank work, AMC work…) are a separate log and are left out.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowRight, ListChecks } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { resolveDataScope, dataScopeSqlViaOwnerBranch } from "@/lib/auth/data-scope";

type Row = {
  person_id: string | null;
  person_name: string | null;
  open: number;
  due_today: number;
  overdue: number;
  done_30d: number;
  total: number;
};

export async function TasksByPersonSection({ session, rmId }: { session: SessionUser; rmId?: string }) {
  const onlyPerson = rmId && /^[0-9a-f-]{36}$/i.test(rmId) ? rmId : undefined;
  let rows: Row[] = [];
  try {
    rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const scope = await resolveDataScope(tx, session);
        const wall = dataScopeSqlViaOwnerBranch(scope, ["t.assignee_id"]);
        const res = await tx.execute(sql`
          SELECT t.assignee_id AS person_id, u.name AS person_name,
                 COUNT(*) FILTER (WHERE t.status IN ('open', 'in_progress', 'blocked'))::int AS open,
                 COUNT(*) FILTER (
                   WHERE t.status IN ('open', 'in_progress', 'blocked')
                     AND (t.due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
                 )::int AS due_today,
                 COUNT(*) FILTER (WHERE t.status IN ('open', 'in_progress', 'blocked') AND t.due_at < now())::int AS overdue,
                 COUNT(*) FILTER (WHERE t.status = 'completed' AND t.completed_at >= now() - interval '30 days')::int AS done_30d,
                 COUNT(*) FILTER (WHERE t.status <> 'cancelled')::int AS total
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assignee_id
           WHERE t.tenant_id = ${session.tenantId}::uuid
             AND t.deleted_at IS NULL
             AND t.type <> 'other_activity'
             AND ${wall}
             AND ${onlyPerson ? sql`t.assignee_id = ${onlyPerson}::uuid` : sql`TRUE`}
           GROUP BY t.assignee_id, u.name
          HAVING COUNT(*) FILTER (WHERE t.status <> 'cancelled') > 0
           ORDER BY overdue DESC, open DESC, u.name ASC NULLS LAST
           LIMIT 60
        `);
        return res.rows as unknown as Row[];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
  } catch (err) {
    // A dashboard panel must never take the whole page down — but say why.
    console.error("[tasks-by-person] failed", err instanceof Error ? err.message : err);
    return null;
  }

  const many = rows.length > 1;

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <ListChecks className="size-3.5 text-violet-600" />
          </div>
          <div>
            <div className="font-medium text-sm">{many ? "Tasks by person" : "My tasks"}</div>
            <div className="text-[11px] text-muted-foreground">
              Open, due today and overdue tasks, and what was completed in the last 30 days
            </div>
          </div>
        </div>
        <Link
          href="/dashboard/tasks"
          className="text-xs text-violet-700 hover:underline font-medium inline-flex items-center gap-1"
        >
          All tasks <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs table-modern">
          <thead>
            <tr>
              <th className="text-left py-1.5 px-3">Person</th>
              <th className="text-right py-1.5 px-3">Open</th>
              <th className="text-right py-1.5 px-3">Due today</th>
              <th className="text-right py-1.5 px-3">Overdue</th>
              <th className="text-right py-1.5 px-3">Completed (30d)</th>
              <th className="text-right py-1.5 px-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 px-3 text-center text-muted-foreground">
                  No tasks to show yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.person_id ?? "unassigned"}>
                  <td className="py-2 px-3 font-medium">
                    {r.person_id === session.userId ? `${r.person_name ?? "You"} (you)` : (r.person_name ?? "Unassigned")}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.open}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.due_today}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${Number(r.overdue) > 0 ? "text-rose-600 font-semibold" : ""}`}>
                    {r.overdue}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.done_30d}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.total}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
