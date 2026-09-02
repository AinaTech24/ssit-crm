"use client";

import { useState } from "react";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

type Point = { label: string; income: number; expense: number };

/**
 * Monthly income-vs-expense bars across the fiscal year. Commission income is
 * lumpy (quarterly AMC payouts) while expenses are steady — this surfaces that
 * cash-flow rhythm at a glance. Pure SVG, no chart library.
 */
export function MonthlyTrendChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const W = 720, H = 160, padB = 22, padT = 8;
  const slot = W / data.length;
  const bw = Math.min(13, slot / 2 - 2);

  const active = hover != null ? data[hover] : null;

  return (
    <div className="card-surface p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="section-title">Monthly income vs expense</h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-emerald-500 inline-block" /> Income</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-rose-400 inline-block" /> Expense</span>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
          <line x1={0} y1={H - padB} x2={W} y2={H - padB} stroke="currentColor" className="text-border" strokeWidth={1} />
          {data.map((d, i) => {
            const cx = i * slot + slot / 2;
            const ih = (d.income / max) * (H - padB - padT);
            const eh = (d.expense / max) * (H - padB - padT);
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={cx - bw - 1} y={H - padB - ih} width={bw} height={ih} rx={2} fill="#10b981" opacity={hover == null || hover === i ? 0.9 : 0.4} />
                <rect x={cx + 1} y={H - padB - eh} width={bw} height={eh} rx={2} fill="#fb7185" opacity={hover == null || hover === i ? 0.9 : 0.4} />
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[9px]">{d.label}</text>
              </g>
            );
          })}
        </svg>
        {active && (active.income > 0 || active.expense > 0) && (
          <div className="absolute top-0 right-0 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
            <div className="font-semibold mb-0.5">{active.label}</div>
            <div className="text-emerald-700 tabular-nums">Income {inr(active.income)}</div>
            <div className="text-rose-600 tabular-nums">Expense {inr(active.expense)}</div>
            <div className="text-muted-foreground tabular-nums border-t mt-1 pt-1">Net {inr(active.income - active.expense)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
