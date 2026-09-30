import { sql } from "drizzle-orm";
import { ListChecks } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { LeaderboardCard, type LeaderboardRow } from "./LeaderboardCard";

/**
 * Open tasks per person, with how many have gone past their due date.
 *
 * The overdue column is the one that matters: a big open number on someone
 * who is working through them is a workload, the same number with a pile of
 * overdue is a problem. Counts by ASSIGNEE — whose desk the work is on, not
 * who created it.
 */
export async function TaskLeaderboard({ session }: { session: SessionUser }) {
  const rows = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT u.id, u.name,
               COUNT(t.id) FILTER (WHERE t.status IN ('open', 'in_progress'))::int AS open_count,
               COUNT(t.id) FILTER (
                 WHERE t.status IN ('open', 'in_progress') AND t.due_at < now()
               )::int AS overdue_count
          FROM users u
          LEFT JOIN tasks t
            ON t.assignee_id = u.id
           AND t.tenant_id = ${session.tenantId}::uuid
           AND t.deleted_at IS NULL
         WHERE u.tenant_id = ${session.tenantId}::uuid
           AND u.status = 'active'
         GROUP BY u.id, u.name
         HAVING COUNT(t.id) FILTER (WHERE t.status IN ('open', 'in_progress')) > 0
         ORDER BY overdue_count DESC, open_count DESC
         LIMIT 8
      `);
      return res.rows as unknown as {
        id: string;
        name: string | null;
        open_count: number;
        overdue_count: number;
      }[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const data: LeaderboardRow[] = rows.map((r) => ({
    id: String(r.id),
    name: (r.name ?? "—").split(" ")[0],
    primary: Number(r.open_count ?? 0),
    secondary: Number(r.overdue_count ?? 0),
    href: `/dashboard/tasks?rm=${r.id}&status=open`,
  }));

  return (
    <LeaderboardCard
      title="Tasks by RM"
      icon={ListChecks}
      tone="amber"
      rows={data}
      primaryLabel="Open"
      secondaryLabel="Overdue"
      secondaryIsAlert
      allHref="/dashboard/tasks"
      allLabel="All tasks →"
      emptyTitle="No open tasks"
      emptyHint="Tasks assigned to your team will rank here, worst overdue first."
      emptyCta={{ href: "/dashboard/tasks/new", label: "Create a task" }}
    />
  );
}
