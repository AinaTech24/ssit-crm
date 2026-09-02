"use client";

/**
 * CalcChart — a small branded area chart for calculator time-series (₹ over
 * years). Multi-series, INR-formatted axes/tooltip, prints cleanly. Built on
 * recharts + the shared ChartMount (avoids the SSR 0×0 warning).
 */

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartMount } from "../dashboards/ChartMount";

export type ChartSeries = { key: string; name: string; color: string };

function inrShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)}cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return `₹${Math.round(v)}`;
}

export function CalcChart({
  data, xKey, xUnit = "Year", series, height = 240,
}: {
  data: Array<Record<string, number | string>>;
  xKey: string;
  xUnit?: string;
  series: ChartSeries[];
  height?: number;
}) {
  if (!data || data.length < 2) return null;
  return (
    <ChartMount className="w-full break-inside-avoid">
      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`cg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}`} />
            <YAxis tick={{ fontSize: 10 }} width={54} tickFormatter={(v) => inrShort(Number(v))} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(v: any, n: any) => [inrShort(Number(v)), n]}
              labelFormatter={(l) => `${xUnit} ${l}`}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((s) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.name}
                stroke={s.color} strokeWidth={2} fill={`url(#cg-${s.key})`} dot={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartMount>
  );
}
