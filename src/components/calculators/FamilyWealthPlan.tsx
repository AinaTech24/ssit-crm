"use client";

/**
 * Young Couple / Family Wealth Plan — projects a lumpsum + monthly SIP across a
 * 4-class portfolio (Equity / Hybrid / Debt / Others) year by year to a total
 * fund value, with an optional cashflow-surplus helper to size the SIP.
 * Math: src/lib/calculators/family-wealth.ts → familyWealthPlan.
 */

import { useMemo, useState } from "react";
import { familyWealthPlan, type AssetClassInput } from "@/lib/calculators/family-wealth";
import { inr, NumberField, Field, Stat, Table, Insight } from "./ui";
import { LinesChart, inrShort } from "./charts";

const CLASS_COLORS = ["#10b981", "#0891b2", "#f59e0b", "#8b5cf6"];
const DEFAULT_CLASSES: AssetClassInput[] = [
  { name: "Equity", allocationPct: 70, returnPct: 12 },
  { name: "Hybrid", allocationPct: 10, returnPct: 10 },
  { name: "Debt", allocationPct: 10, returnPct: 7 },
  { name: "Others", allocationPct: 10, returnPct: 8 },
];

export function FamilyWealthPlan() {
  const [clientName, setClientName] = useState("");
  const [lumpsum, setLumpsum] = useState(500000);
  const [sip, setSip] = useState(100000);
  const [currentAge, setCurrentAge] = useState(30);
  const [targetAge, setTargetAge] = useState(60);
  const [classes, setClasses] = useState<AssetClassInput[]>(DEFAULT_CLASSES);

  // Optional cashflow → surplus helper
  const [income, setIncome] = useState(225000);
  const [expenses, setExpenses] = useState(78000);
  const [emis, setEmis] = useState(15000);
  const surplus = Math.max(0, income - expenses - emis);

  const res = useMemo(
    () => familyWealthPlan({ lumpsum, monthlySip: sip, currentAge, targetAge, classes }),
    [lumpsum, sip, currentAge, targetAge, classes],
  );

  const setClass = (i: number, patch: Partial<AssetClassInput>) =>
    setClasses((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const allocOff = Math.abs(res.allocationSumPct - 100) > 0.01;
  const multiple = res.totalInvested > 0 ? res.finalTotal / res.totalInvested : 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Family Wealth Plan</h2>
        <p className="text-xs text-muted-foreground">
          Project a couple&rsquo;s lumpsum + monthly SIP across a 4-class portfolio and watch the total fund value grow to the target age.
        </p>
      </div>

      {/* Cashflow → surplus helper */}
      <div className="rounded-lg border border-border bg-secondary/20 p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
          Investable surplus (optional)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <NumberField label="Combined income (₹/mo)" value={income} setValue={setIncome} step={5000} />
          <NumberField label="Living expenses (₹/mo)" value={expenses} setValue={setExpenses} step={2500} />
          <NumberField label="Existing EMIs (₹/mo)" value={emis} setValue={setEmis} step={1000} />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Surplus</div>
            <div className="flex items-center gap-2">
              <div className="text-base font-semibold text-emerald-700">{inr(surplus)}/mo</div>
              <button type="button" onClick={() => setSip(surplus)} className="btn-ghost text-[11px] whitespace-nowrap">
                Use as SIP
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Client name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Lumpsum today (₹)" value={lumpsum} setValue={setLumpsum} step={100000} />
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} step={5000} />
        <NumberField label="Current age" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Target age" value={targetAge} setValue={setTargetAge} step={1} />
      </div>

      {/* Asset allocation editor */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Asset allocation</div>
          <div className={`text-[11px] font-medium ${allocOff ? "text-amber-600" : "text-muted-foreground"}`}>
            Total {res.allocationSumPct.toFixed(0)}%{allocOff ? " — normalised to 100%" : ""}
          </div>
        </div>
        <div className="space-y-1.5">
          {classes.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm shrink-0" style={{ background: CLASS_COLORS[i] }} />
              <div className="w-24 text-sm font-medium">{c.name}</div>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Alloc</span>
                <input
                  type="number"
                  min={0}
                  value={c.allocationPct}
                  onChange={(e) => setClass(i, { allocationPct: Number(e.target.value) || 0 })}
                  className="input-base text-xs w-20"
                />
                <span className="text-muted-foreground">%</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Return</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={c.returnPct}
                  onChange={(e) => setClass(i, { returnPct: Number(e.target.value) || 0 })}
                  className="input-base text-xs w-20"
                />
                <span className="text-muted-foreground">% p.a.</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
          Total wealth at age {targetAge}
        </div>
        <div className="text-3xl font-extrabold text-emerald-700 mt-1">{inrShort(res.finalTotal)}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {clientName ? `${clientName} — ` : ""}over {res.years} years, from {inr(res.totalInvested)} invested
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total invested" value={inrShort(res.totalInvested)} />
        <Stat label={`Corpus at ${targetAge}`} value={inrShort(res.finalTotal)} tone="emerald" />
        <Stat label="Wealth multiple" value={`${multiple.toFixed(1)}×`} tone="cyan" />
        <Stat label="Blended return" value={`${res.blendedReturnPct.toFixed(1)}%`} tone="amber" />
      </div>

      {/* Final allocation split */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
          Corpus by asset class at age {targetAge}
        </div>
        <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
          {res.finalByClass.map((v, i) => {
            const pct = res.finalTotal > 0 ? (v / res.finalTotal) * 100 : 0;
            return (
              <div
                key={i}
                className="h-full flex items-center justify-center text-[10px] font-semibold text-white"
                style={{ width: `${Math.max(3, pct)}%`, background: CLASS_COLORS[i] }}
                title={`${classes[i].name}: ${inrShort(v)}`}
              >
                {pct.toFixed(0)}%
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[11px]">
          {classes.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: CLASS_COLORS[i] }} /> {c.name} {inrShort(res.finalByClass[i])}
            </span>
          ))}
        </div>
      </div>

      <LinesChart
        ariaLabel="Total fund value over the years"
        xLabels={res.series.map((s) => `Age ${s.age}`)}
        fmtY={(v) => inrShort(v)}
        lines={[{ label: "Total fund value", color: "#10b981", values: res.series.map((s) => s.total) }]}
      />

      <Table
        head={["Age", "Year", "Total fund value"]}
        rows={res.series
          .filter((s) => s.year === res.years || s.year % 5 === 0)
          .map((s) => [s.age, s.year, inrShort(s.total)])}
        highlightLastRow
        highlightCol={2}
      />

      <Insight tone="emerald">
        Investing {inr(lumpsum)} today plus {inr(sip)}/month across this mix (blended ~{res.blendedReturnPct.toFixed(1)}%) grows to{" "}
        <strong>{inrShort(res.finalTotal)}</strong> by age {targetAge} — a {multiple.toFixed(1)}× return on the {inr(res.totalInvested)}{" "}
        actually invested. The equity-heavy allocation does the heavy lifting; debt &amp; hybrid steady the ride.
      </Insight>

      <Insight tone="amber">
        Illustration only — returns are market-linked and not guaranteed. Rebalance the allocation periodically and review as income,
        goals and risk appetite change.
      </Insight>
    </div>
  );
}
