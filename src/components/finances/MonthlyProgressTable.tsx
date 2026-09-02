"use client";

/**
 * Monthly progress (8.5) — annual target vs computed actuals per metric,
 * with completed / pending and a month-by-month grid. Targets are editable
 * inline (PUT /api/business-targets).
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { FY_MONTHS } from "@/lib/finance/fiscal-year";

export type MetricKey =
  | "new_clients"
  | "leads_generated"
  | "meetings_done"
  | "aum_addition"
  | "sip_book_addition"
  | "lumpsum_added";

export type MetricRow = {
  metric: MetricKey;
  label: string;
  kind: "count" | "currency";
  total: number;
  byMonth: Record<number, number>; // calendar month (0..11) → value
  target: number;
};

const fmt = (kind: "count" | "currency", v: number) =>
  kind === "currency" ? formatINR(v) : v.toLocaleString("en-IN");

export function MonthlyProgressTable({
  fy,
  rows: initialRows,
}: {
  fy: string;
  rows: MetricRow[];
}) {
  const [rows, setRows] = useState<MetricRow[]>(initialRows);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function saveTarget(metric: MetricKey, value: number) {
    setSavingKey(metric);
    try {
      await fetch("/api/business-targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fiscalYear: fy, metric, annualTarget: value }),
      });
    } finally {
      setSavingKey(null);
    }
  }

  function onTargetChange(metric: MetricKey, raw: string) {
    const n = parseFloat(raw.replace(/[^0-9.]/g, "")) || 0;
    setRows((s) => s.map((r) => (r.metric === metric ? { ...r, target: n } : r)));
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Particulars</th>
              <th className="text-right py-2 font-medium">Annual target</th>
              <th className="text-right py-2 font-medium">Completed</th>
              <th className="text-right py-2 font-medium">Pending</th>
              <th className="text-left py-2 font-medium pl-3 w-32">Progress</th>
              {FY_MONTHS.map((m) => (
                <th key={m.key} className="text-right py-2 font-medium px-1 text-[10px]">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pending = Math.max(0, r.target - r.total);
              const pct = r.target > 0 ? Math.min(100, (r.total / r.target) * 100) : 0;
              const tone = pct >= 90 ? "emerald" : pct >= 50 ? "amber" : "rose";
              const bar = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
              return (
                <tr key={r.metric} className="border-b last:border-0 hover:bg-secondary/30">
                  <td className="px-4 py-2.5 font-medium">{r.label}</td>
                  <td className="py-2.5 text-right">
                    <div className="inline-flex items-center gap-1 justify-end">
                      {savingKey === r.metric && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                      <input
                        inputMode="decimal"
                        value={r.target || ""}
                        onChange={(e) => onTargetChange(r.metric, e.target.value)}
                        onBlur={(e) => saveTarget(r.metric, parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                        placeholder="0"
                        className="w-28 text-right input-base text-xs tabular-nums py-1"
                      />
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">{fmt(r.kind, r.total)}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{fmt(r.kind, pending)}</td>
                  <td className="py-2.5 pl-3 pr-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  {FY_MONTHS.map((m) => {
                    const v = r.byMonth[m.key] ?? 0;
                    return (
                      <td key={m.key} className="py-2.5 px-1 text-right text-[10px] tabular-nums text-muted-foreground">
                        {v ? (r.kind === "currency" ? compact(v) : v) : "·"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">
        Actuals are computed live from your clients, leads, meetings and transactions. Edit a target
        and it saves automatically.
      </div>
    </div>
  );
}

/** Compact ₹ for the dense month cells: 12,50,000 → 12.5L, 2,00,00,000 → 2Cr. */
function compact(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}
