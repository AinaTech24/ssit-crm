"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ChartMount } from "./ChartMount";

type CampaignRoi = {
  name: string;
  sent: number;
  read: number;
  replied: number;
};

export function CampaignRoiChart({ data }: { data: CampaignRoi[] }) {
  if (!data.length) {
    return (
      <div className="h-48 grid place-items-center text-xs text-muted-foreground">
        No campaign broadcasts in this period.
      </div>
    );
  }

  return (
    <ChartMount className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
          <XAxis dataKey="name" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: "0.5rem",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="sent" fill="hsl(221, 83%, 18%)" name="Sent" radius={[3, 3, 0, 0]} />
          <Bar dataKey="read" fill="hsl(199, 89%, 48%)" name="Read" radius={[3, 3, 0, 0]} />
          <Bar dataKey="replied" fill="hsl(165, 70%, 45%)" name="Replied" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
