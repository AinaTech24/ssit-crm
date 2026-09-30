import { sql } from "drizzle-orm";
import { LifeBuoy } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { LeaderboardCard, type LeaderboardRow } from "./LeaderboardCard";

/**
 * Open service requests per person, and how many have blown their SLA.
 *
 * Breached is the column to read — an open queue is normal, a breached one is
 * a promise already missed, and on a complaint that promise is SEBI's 21 days
 * rather than the firm's own.
 *
 * Counted against the assignee. Tickets nobody has picked up yet are grouped
 * under "Unassigned" rather than dropped, because an unowned backlog is
 * exactly what a firm admin needs to see.
 */
export async function ServiceRequestLeaderboard({ session }: { session: SessionUser }) {
  const rows = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT COALESCE(u.id::text, 'unassigned') AS id,
               COALESCE(u.name, 'Unassigned') AS name,
               COUNT(*)::int AS open_count,
               COUNT(*) FILTER (WHERE sr.sla_resolution_at < now())::int AS breached_count
          FROM service_requests sr
          LEFT JOIN users u ON u.id = sr.assigned_to_user_id
         WHERE sr.tenant_id = ${session.tenantId}::uuid
           AND sr.status NOT IN ('resolved', 'closed')
         GROUP BY u.id, u.name
         ORDER BY breached_count DESC, open_count DESC
         LIMIT 8
      `);
      return res.rows as unknown as {
        id: string;
        name: string | null;
        open_count: number;
        breached_count: number;
      }[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const data: LeaderboardRow[] = rows.map((r) => ({
    id: String(r.id),
    name: (r.name ?? "—").split(" ")[0],
    primary: Number(r.open_count ?? 0),
    secondary: Number(r.breached_count ?? 0),
    href:
      r.id === "unassigned"
        ? "/dashboard/service-requests"
        : `/dashboard/service-requests?assignee=${r.id}`,
  }));

  return (
    <LeaderboardCard
      title="Service requests by RM"
      icon={LifeBuoy}
      tone="rose"
      rows={data}
      primaryLabel="Open"
      secondaryLabel="Breached"
      secondaryIsAlert
      allHref="/dashboard/service-requests"
      allLabel="All requests →"
      emptyTitle="No open service requests"
      emptyHint="Open tickets will rank by the person working them, worst SLA breach first."
      emptyCta={{ href: "/dashboard/service-requests", label: "Open the queue" }}
    />
  );
}
