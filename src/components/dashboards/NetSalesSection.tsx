import React from "react";
import { sql } from "drizzle-orm";
import { TrendingUp } from "lucide-react";
import { withTenant } from "@/db/client";
import { NetSalesChart } from "./NetSalesChart";
import type { SessionUser } from "@/lib/auth/session";

export async function NetSalesSection({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        WITH dates AS (
          SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS d
        )
        SELECT d::text AS day,
          COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric END), 0)::numeric AS gross,
          COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric END), 0)::numeric AS redemption,
          COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net
        FROM dates LEFT JOIN transactions t
          ON t.order_date = dates.d AND t.status IN ('processed', 'successful')
        GROUP BY d ORDER BY d
      `);
      return res.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const dailySales = data.map((r) => ({
    day: String(r.day),
    gross: Number(r.gross),
    redemption: Number(r.redemption),
    net: Number(r.net),
  }));

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <TrendingUp className="size-3.5 text-brand-cyan-deep" />
          </div>
          Net sales — last 30 days
        </h2>
        <span className="text-xs text-muted-foreground">Daily inflow vs redemption</span>
      </div>
      <NetSalesChart data={dailySales} />
    </div>
  );
}
