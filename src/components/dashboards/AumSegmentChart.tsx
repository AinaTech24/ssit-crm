"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { formatINR } from "@/lib/utils";
import { ChartMount } from "./ChartMount";

type SegmentData = { name: string; value: number; count: number };

const COLORS = [
  "hsl(199, 89%, 48%)", // Electric Cyan
  "hsl(256, 70%, 60%)", // Brand Violet
  "hsl(165, 70%, 45%)", // Brand Mint
  "hsl(221, 83%, 18%)", // Deep Navy
  "hsl(36, 100%, 55%)",  // Warm Orange
];

export function AumSegmentChart({ data }: { data: SegmentData[] }) {
  const totalAum = data.reduce((sum, item) => sum + item.value, 0);

  if (!data.some(d => d.value > 0)) {
    return (
      <div className="h-48 grid place-items-center text-xs text-muted-foreground">
        No active client AUM data available.
      </div>
    );
  }

  return (
    <ChartMount className="h-56 w-full relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={75}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: "0.5rem",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
            formatter={(value: any, name: any, props: any) => [
              `${formatINR(Number(value))} (${props.payload.count} clients)`,
              name,
            ]}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 10 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Total AUM
        </div>
        <div className="text-xs font-bold text-foreground truncate max-w-[100px]">
          {formatINR(totalAum)}
        </div>
      </div>
    </ChartMount>
  );
}
