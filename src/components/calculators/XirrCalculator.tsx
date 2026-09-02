"use client";

/**
 * XIRR Calculator — true annualised return on irregular, dated cashflows.
 * Math: src/lib/calculators/xirr.ts. A daily MFD research workhorse.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { computeXirr, type DatedCashflow } from "@/lib/calculators/xirr";
import { inr, Stat, Insight } from "./ui";

let nextId = 1;
type Row = DatedCashflow & { id: number };
const mk = (date: string, amount: number): Row => ({ id: nextId++, date, amount });

export function XirrCalculator() {
  const [rows, setRows] = useState<Row[]>(() => [
    mk("2021-04-01", -100000),
    mk("2022-04-01", -100000),
    mk("2023-04-01", -100000),
    mk("2026-06-11", 420000),
  ]);

  const result = useMemo(() => computeXirr(rows.map(({ date, amount }) => ({ date, amount }))), [rows]);

  function update(id: number, patch: Partial<Row>) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() { setRows((prev) => [...prev, mk(prev[prev.length - 1]?.date ?? "2026-01-01", -100000)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 2 ? prev : prev.filter((r) => r.id !== id))); }

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">XIRR Calculator</h2>
        <p className="text-xs text-muted-foreground">
          The true annualised return on any series of dated cashflows — investments
          (negative) and redemptions / current value (positive). Handles lumpy,
          irregular contributions a simple CAGR can&apos;t.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id} className="flex items-end gap-2">
            <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Date</span>
              <input type="date" value={r.date} onChange={(e) => update(r.id, { date: e.target.value })} className="input-base text-sm w-44" /></label>
            <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Amount (₹) — invest −, redeem +</span>
              <input type="number" step={10000} value={r.amount} onChange={(e) => update(r.id, { amount: Number(e.target.value) || 0 })} className={`input-base text-sm w-40 text-right ${r.amount < 0 ? "text-rose-600" : "text-emerald-700"}`} /></label>
            <span className="text-[10px] text-muted-foreground pb-2">{r.amount < 0 ? "investment" : "inflow / value"}</span>
            <button type="button" onClick={() => remove(r.id)} className="text-rose-500 hover:text-rose-700 pb-1.5 print:hidden" aria-label="Remove"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add cashflow</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="XIRR (annualised)" value={result.xirrPct == null ? "—" : `${result.xirrPct.toFixed(2)}%`} tone="cyan" />
        <Stat label="Total invested" value={inr(result.totalInvested)} />
        <Stat label="Total value / returned" value={inr(result.totalReturned)} />
        <Stat label="Absolute return" value={`${result.absoluteReturnPct.toFixed(1)}%`} tone={result.netGain >= 0 ? "emerald" : "rose"} />
      </div>

      {result.xirrPct != null ? (
        <Insight tone={result.xirrPct >= 0 ? "emerald" : "rose"}>
          These cashflows earned an annualised <strong>{result.xirrPct.toFixed(2)}% XIRR</strong> — a net gain of{" "}
          <strong>{inr(result.netGain)}</strong> on {inr(result.totalInvested)} invested. XIRR is the rate that
          fairly accounts for <em>when</em> each rupee went in or came out.
        </Insight>
      ) : (
        <Insight tone="amber">Add at least one investment (negative) and one inflow/value (positive) with valid dates to compute XIRR.</Insight>
      )}
    </div>
  );
}
