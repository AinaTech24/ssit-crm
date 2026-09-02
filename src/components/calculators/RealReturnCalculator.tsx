"use client";

/**
 * Real Return (Inflation + Tax) Calculator — what a headline return is really
 * worth after tax and inflation. Math: src/lib/calculators/real-return.ts.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { computeRealReturns, type Instrument } from "@/lib/calculators/real-return";
import { inr, clampNum, NumberField, Insight } from "./ui";

let nextId = 1;
type Row = Instrument & { id: number };
const mk = (name: string, nominalPct: number, taxPct: number): Row => ({ id: nextId++, name, nominalPct, taxPct });

export function RealReturnCalculator() {
  const [inflationPct, setInflationPct] = useState(6);
  const [amount, setAmount] = useState(1000000);
  const [years, setYears] = useState(10);
  const [rows, setRows] = useState<Row[]>(() => [
    mk("Savings account", 3, 30),
    mk("Fixed deposit", 7, 30),
    mk("Debt fund", 8, 30),
    mk("Equity fund", 12, 12.5),
  ]);

  const results = useMemo(
    () => computeRealReturns(rows, inflationPct, amount, years),
    [rows, inflationPct, amount, years]
  );

  function update(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function add() { setRows((prev) => [...prev, mk("New instrument", 7, 30)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  const fmtPctSigned = (n: number) => `${n >= 0 ? "" : ""}${n.toFixed(2)}%`;
  const worst = results.reduce((a, b) => (b.realPct < a.realPct ? b : a), results[0]);
  const best = results.reduce((a, b) => (b.realPct > a.realPct ? b : a), results[0]);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Real Return Calculator <span className="text-xs font-normal text-muted-foreground">(inflation + tax)</span></h2>
        <p className="text-xs text-muted-foreground">
          A 7% FD isn&apos;t really 7%. See what each instrument earns <em>after</em> tax and inflation — the return that actually grows your wealth.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Expected inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />
        <NumberField label="Amount (₹)" value={amount} setValue={setAmount} step={100000} />
        <NumberField label="Years (for purchasing power)" value={years} setValue={setYears} step={1} />
      </div>

      <div className="overflow-x-auto">
        <table data-pdf="table" className="w-full text-sm border-collapse min-w-[640px]">
          <thead>
            <tr className="text-left">
              {["Instrument", "Nominal %", "Tax %", "Post-tax %", "Real return %", `Real value in ${years}y`, ""].map((h, i) => (
                <th key={i} className={`py-1.5 px-2 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border ${i >= 1 && i <= 5 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const res = results[idx];
              return (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="p-1.5"><input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} className="input-base text-sm w-36" /></td>
                  <td className="p-1.5"><input type="number" step={0.25} value={r.nominalPct} onChange={(e) => update(r.id, { nominalPct: clampNum(e.target.value) })} className="input-base text-sm w-20 text-right" /></td>
                  <td className="p-1.5"><input type="number" step={2.5} value={r.taxPct} onChange={(e) => update(r.id, { taxPct: clampNum(e.target.value) })} className="input-base text-sm w-20 text-right" /></td>
                  <td className="p-1.5 text-right tabular-nums">{res.postTaxNominalPct.toFixed(2)}%</td>
                  <td className={`p-1.5 text-right tabular-nums font-semibold ${res.realPct < 0 ? "text-rose-600" : "text-emerald-700"}`}>{fmtPctSigned(res.realPct)}</td>
                  <td className="p-1.5 text-right tabular-nums">{inr(res.realFutureValue)}</td>
                  <td className="p-1.5 text-center"><button type="button" onClick={() => remove(r.id)} className="text-rose-500 hover:text-rose-700 print:hidden" aria-label="Remove"><Trash2 className="size-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add instrument</button>

      {best && worst && (
        <Insight tone={worst.realPct < 0 ? "rose" : "emerald"}>
          {worst.realPct < 0
            ? <><strong>{worst.name}</strong> actually <strong>loses</strong> {Math.abs(worst.realPct).toFixed(2)}% a year in real, post-tax terms — your money buys less over time. </>
            : <><strong>{worst.name}</strong> barely keeps pace with inflation after tax. </>}
          <strong>{best.name}</strong> delivers the strongest real return ({best.realPct.toFixed(2)}%) — the gap is the real cost of playing it &quot;safe.&quot;
        </Insight>
      )}
    </div>
  );
}
