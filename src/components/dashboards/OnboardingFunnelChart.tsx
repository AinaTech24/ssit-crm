"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ChartMount } from "./ChartMount";

type FunnelStep = { name: string; value: number; percentage: number };

const COLORS = [
  "hsl(221, 83%, 18%)", // Deep Navy
  "hsl(256, 70%, 45%)", // Indigo
  "hsl(256, 70%, 60%)", // Brand Violet
  "hsl(280, 65%, 55%)", // Purple
  "hsl(199, 89%, 48%)", // Electric Cyan
  "hsl(165, 70%, 45%)", // Brand Mint
];

export function OnboardingFunnelChart({ data }: { data: FunnelStep[] }) {
  if (!data.some(d => d.value > 0)) {
    return (
      <div className="h-56 grid place-items-center text-xs text-muted-foreground">
        No active clients in the onboarding pipeline.
      </div>
    );
  }

  return (
    <ChartMount className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 15, right: 30, left: 30, bottom: 10 }}
        >
          <XAxis type="number" hide />
          <YAxis
            dataKey="name"
            type="category"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "currentColor", fontSize: 11 }}
            width={120}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: "0.5rem",
              border: "1px solid rgba(0,0,0,0.08)",
              backgroundColor: "rgba(255, 255, 255, 0.95)",
            }}
            formatter={(v: any, name: any, props: any) => [
              `${v} Clients (${props.payload.percentage.toFixed(0)}%)`,
              "Count",
            ]}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
