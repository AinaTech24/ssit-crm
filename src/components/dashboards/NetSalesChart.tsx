"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartMount } from "./ChartMount";
import { DashboardEmptyState } from "./DashboardEmptyState";

type Point = { day: string; gross: number; redemption: number; net: number };

/**
 * Net-sales area chart. Period-aware:
 *  - `granularity` ("day" | "week") tells the axis/tooltip how to label each
 *    bucket — the cockpit buckets long ranges by week so the chart stays
 *    readable. The data shape is identical either way (one row per bucket,
 *    `day` = the bucket's start date as an ISO string).
 *  - `emptyCta` lets the caller route the empty state somewhere useful.
 */
export function NetSalesChart({
  data,
  granularity = "day",
  emptyTitle = "No transactions in this period yet",
  emptyHint = "Once trades are booked or synced from the RTA, daily inflow vs redemption shows up here.",
  emptyCta = { href: "/dashboard/transactions", label: "View transactions" },
}: {
  data: Point[];
  granularity?: "day" | "week";
  emptyTitle?: string;
  emptyHint?: string;
  emptyCta?: { href: string; label: string };
}) {
  // "Empty" = no rows at all, OR every bucket is flat zero (a generated date
  // series with no matching transactions). Either way there's nothing to read.
  const hasSignal = data.some((d) => d.gross !== 0 || d.redemption !== 0);
  if (!data.length || !hasSignal) {
    return <DashboardEmptyState title={emptyTitle} hint={emptyHint} cta={emptyCta} />;
  }

  const fmtAxis = (d: any) =>
    new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const fmtLabel = (d: any) => {
    const start = new Date(d);
    if (granularity === "week") {
      return `Week of ${start.toLocaleDateString("en-IN", { dateStyle: "medium" })}`;
    }
    return start.toLocaleDateString("en-IN", { dateStyle: "medium" });
  };

  return (
    <ChartMount className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="redemption" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(v: any) => `₹${Number(v).toLocaleString("en-IN")}`}
            labelFormatter={fmtLabel}
          />
          <Area type="monotone" dataKey="gross" stroke="#10b981" fill="url(#gross)" strokeWidth={2} name="Gross inflow" />
          <Area type="monotone" dataKey="redemption" stroke="#ef4444" fill="url(#redemption)" strokeWidth={2} name="Redemption" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
