import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { DashboardEmptyState } from "./DashboardEmptyState";

export async function RmLeaderboard({
  session,
  period,
  periodQuery = "",
}: {
  session: SessionUser;
  /** Active cockpit period — kept for drill-down scoping (the AUM/SIP figures
   *  shown here are current snapshots, so the aggregate itself is period-independent). */
  period?: string;
  /** Pre-built "?period=…&pstart=…" suffix so the drill-down opens in the same window. */
  periodQuery?: string;
}) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT u.id, u.name AS rm_name,
          COUNT(DISTINCT i.id)::int AS clients,
          COALESCE(SUM(i.aum::numeric), 0)::numeric AS aum,
          COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS sip_book
        FROM users u
        LEFT JOIN investors i ON i.rm_id = u.id AND i.status = 'active' AND i.deleted_at IS NULL
        WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
        GROUP BY u.id, u.name
        ORDER BY aum DESC NULLS LAST
        LIMIT 8
      `);
      return res.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // A leaderboard where every RM has zero clients/AUM is as empty as no rows.
  const hasSignal = data.some((r) => Number(r.clients) > 0 || Number(r.aum) > 0);

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <Users className="size-3.5 text-violet-600" />
          </div>
          RM Leaderboard
        </h2>
        <Link
          href={`/dashboard/reports/rm_business${periodQuery}`}
          className="text-xs text-violet-700 hover:underline font-medium"
        >
          All RMs →
        </Link>
      </div>
      {data.length === 0 ? (
        <DashboardEmptyState
          icon={Users}
          title="No RMs configured yet"
          hint="Invite relationship managers and assign clients to them to rank business by RM."
          cta={{ href: "/dashboard/settings/team", label: "Manage team" }}
          compact
        />
      ) : !hasSignal ? (
        <DashboardEmptyState
          icon={Users}
          title="No client business mapped to RMs"
          hint="Assign clients to your RMs to see AUM and SIP book ranked per relationship manager."
          cta={{ href: `/dashboard/investors${periodQuery}`, label: "Assign clients" }}
          compact
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-modern">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2">RM</th>
                <th className="text-right py-1.5 px-2">Clients</th>
                <th className="text-right py-1.5 px-2">AUM</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 5).map((r: any) => (
                <tr key={r.id}>
                  <td className="py-2 px-2 font-medium">{r.rm_name.split(" ")[0]}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.clients}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">
                    {formatINR(Number(r.aum))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
