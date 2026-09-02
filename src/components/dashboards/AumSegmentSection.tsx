import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { AumSegmentChart } from "./AumSegmentChart";
import type { SessionUser } from "@/lib/auth/session";

export async function AumSegmentSection({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          COALESCE(segment_tag, 'Retail') AS segment,
          COUNT(*)::int AS client_count,
          COALESCE(SUM(aum::numeric), 0)::numeric AS total_aum
        FROM investors
        WHERE status = 'active' AND deleted_at IS NULL
        GROUP BY segment_tag
      `);
      return res.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const aumSegments = data.map((r) => ({
    name: String(r.segment),
    value: Number(r.total_aum),
    count: Number(r.client_count),
  }));

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
            <Users className="size-3.5 text-emerald-600" />
          </div>
          AUM by Client Segment
        </h2>
        <Link href="/dashboard/investors" className="text-xs text-emerald-700 hover:underline font-medium">
          Clients →
        </Link>
      </div>
      <AumSegmentChart data={aumSegments} />
    </div>
  );
}
