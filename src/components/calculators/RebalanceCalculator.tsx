"use client";

/**
 * Portfolio Rebalancing — exact buy/sell per asset class to hit a target
 * allocation, deploying new money to the underweight slices first.
 * Math: src/lib/calculators/rebalance.ts.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { computeRebalance, type Holding } from "@/lib/calculators/rebalance";
import { inr, clampNum, NumberField, Stat, Insight } from "./ui";

let nextId = 1;
type Row = Holding & { id: number };
const mk = (assetClass: string, currentValue: number, targetPct: number): Row => ({ id: nextId++, assetClass, currentValue, targetPct });

export function RebalanceCalculator() {
  const [newMoney, setNewMoney] = useState(0);
  const [rows, setRows] = useState<Row[]>(() => [
    mk("Equity", 1400000, 60),
    mk("Debt", 700000, 30),
    mk("Gold", 100000, 10),
  ]);

  const result = useMemo(
    () => computeRebalance(rows.map(({ assetClass, currentValue, targetPct }) => ({ assetClass, currentValue, targetPct })), newMoney),
    [rows, newMoney]
  );

  function update(id: number, patch: Partial<Row>) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() { setRows((prev) => [...prev, mk("New class", 0, 0)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  const targetTotal = rows.reduce((s, r) => s + r.targetPct, 0);
  const targetBad = Math.abs(targetTotal - 100) > 0.01;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Portfolio Rebalancing</h2>
        <p className="text-xs text-muted-foreground">
          The exact amount to buy or sell in each asset class to get back to the
          target mix — using fresh money first so you sell (and trigger tax) less.
        </p>
      </div>

      <NumberField label="New money to invest (₹, optional)" value={newMoney} setValue={setNewMoney} step={50000} />

      <div className="overflow-x-auto">
        <table data-pdf="table" className="w-full text-sm border-collapse min-w-[680px]">
          <thead>
            <tr className="text-left">
              {["Asset class", "Current ₹", "Current %", "Target %", "Target ₹", "Action", "From new money", ""].map((h, i) => (
                <th key={i} className={`py-1.5 px-2 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border ${i >= 1 && i <= 6 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const res = result.rows[idx];
              return (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="p-1.5"><input value={r.assetClass} onChange={(e) => update(r.id, { assetClass: e.target.value })} className="input-base text-sm w-32" /></td>
                  <td className="p-1.5"><input type="number" step={50000} value={r.currentValue} onChange={(e) => update(r.id, { currentValue: clampNum(e.target.value) })} className="input-base text-sm w-32 text-right" /></td>
                  <td className="p-1.5 text-right tabular-nums">{res?.currentPct.toFixed(1)}%</td>
                  <td className="p-1.5"><input type="number" step={5} value={r.targetPct} onChange={(e) => update(r.id, { targetPct: clampNum(e.target.value) })} className="input-base text-sm w-20 text-right" /></td>
                  <td className="p-1.5 text-right tabular-nums">{inr(res?.targetValue ?? 0)}</td>
                  <td className={`p-1.5 text-right tabular-nums font-semibold ${(res?.action ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {(res?.action ?? 0) >= 0 ? "Buy " : "Sell "}{inr(Math.abs(res?.action ?? 0))}
                  </td>
                  <td className="p-1.5 text-right tabular-nums text-muted-foreground">{res?.fromNewMoney ? inr(res.fromNewMoney) : "—"}</td>
                  <td className="p-1.5 text-center"><button type="button" onClick={() => remove(r.id)} className="text-rose-500 hover:text-rose-700 print:hidden" aria-label="Remove"><Trash2 className="size-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add asset class</button>
      {targetBad && <p className="text-[11px] text-rose-600">Target allocation should total 100% (currently {targetTotal.toFixed(0)}%).</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Portfolio value" value={inr(result.totalCurrent)} />
        <Stat label="After new money" value={inr(result.totalAfter)} tone="cyan" />
        <Stat label="To buy" value={inr(result.totalBuy)} tone="emerald" />
        <Stat label="To sell" value={inr(result.totalSell)} tone="rose" />
      </div>

      <Insight tone="cyan">
        Rebalancing realigns risk to plan. {result.totalSell > 0
          ? <>Selling {inr(result.totalSell)} of the overweight classes may trigger capital-gains tax — using the {inr(result.newMoneyUsed)} of new money first keeps that to a minimum.</>
          : <>New money alone covers the rebalance — no selling, so no tax event.</>}
      </Insight>
    </div>
  );
}
