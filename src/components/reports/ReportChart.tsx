"use client";

/**
 * Renders a matrix report as a bar / pie / line chart. Single-series matrices
 * chart the per-row total; pivot matrices render one series per pivot column.
 * Fixed-height block + ResponsiveContainer 100% (the correct sizing pattern).
 */
import {
  ResponsiveContainer,
  BarChart, Bar,
  PieChart, Pie, Cell,
  LineChart, Line,
  AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";

type Matrix = {
  groupByLabel: string;
  colLabels: string[];
  rows: { key: string; cells: number[]; total: number }[];
};
export type ReportChartType = "bar" | "pie" | "line" | "area" | "donut";

const COLORS = [
  "hsl(199, 89%, 48%)", // cyan
  "hsl(256, 70%, 60%)", // violet
  "hsl(165, 70%, 45%)", // mint
  "hsl(221, 83%, 35%)", // navy
  "hsl(36, 100%, 55%)", // orange
  "hsl(330, 70%, 55%)", // pink
];

export default function ReportChart({ chartType, matrix }: { chartType: ReportChartType; matrix: Matrix }) {
  const single = matrix.colLabels.length <= 1;
  const series = single ? ["total"] : matrix.colLabels;
  const data = matrix.rows.map((r) => {
    const o: Record<string, string | number> = { name: r.key || "—", total: r.total };
    matrix.colLabels.forEach((c, i) => (o[c] = r.cells[i] ?? 0));
    return o;
  });
  const pieData = matrix.rows.map((r) => ({ name: r.key || "—", value: r.total }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chartType === "pie" || chartType === "donut" ? (
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={chartType === "donut" ? 55 : 45} paddingAngle={2}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : chartType === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 28% 90%)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((c, i) => (
              <Area key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.18} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : chartType === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 28% 90%)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 28% 90%)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((c, i) => (
              <Bar key={c} dataKey={c} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
