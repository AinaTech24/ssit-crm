"use client";

/**
 * Goal-Feasibility Score — a 0-100 "are the goals on track" score with the exact
 * monthly gap. Math: src/lib/calculators/goal-feasibility.ts.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import { computeGoalFeasibility, type FeasGoal } from "@/lib/calculators/goal-feasibility";
import { inr, clampNum, NumberField, Field, Section, Stat, Insight } from "./ui";

let nextId = 1;
type Row = FeasGoal & { id: number };
const mk = (name: string, futureCost: number, yearsAway: number, returnPct: number): Row => ({ id: nextId++, name, futureCost, yearsAway, returnPct });

export function GoalFeasibilityScore() {
  const [clientName, setClientName] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState(200000);
  const [currentMonthlySip, setCurrentMonthlySip] = useState(40000);
  const [existingCorpus, setExistingCorpus] = useState(2500000);
  const [corpusReturnPct, setCorpusReturnPct] = useState(11);
  const [rows, setRows] = useState<Row[]>(() => [
    mk("Child education", 8000000, 12, 12),
    mk("Retirement", 50000000, 25, 12),
    mk("Home", 4000000, 6, 10),
  ]);

  const result = useMemo(
    () => computeGoalFeasibility({ monthlyIncome, currentMonthlySip, existingCorpus, corpusReturnPct, goals: rows.map(({ name, futureCost, yearsAway, returnPct }) => ({ name, futureCost, yearsAway, returnPct })) }),
    [monthlyIncome, currentMonthlySip, existingCorpus, corpusReturnPct, rows]
  );

  function update(id: number, patch: Partial<Row>) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() { setRows((prev) => [...prev, mk("New goal", 1000000, 5, 11)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  const s = result.score;
  const tone = s >= 80 ? "emerald" : s >= 55 ? "amber" : "rose";
  const verdict = s >= 80 ? "On track" : s >= 55 ? "Needs attention" : "Off track";

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Goal-Feasibility Score</h2>
        <p className="text-xs text-muted-foreground">
          One number that answers &quot;are my goals achievable on my current plan?&quot; —
          with the exact monthly shortfall if they&apos;re not.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Monthly income (₹)" value={monthlyIncome} setValue={setMonthlyIncome} step={10000} />
        <NumberField label="Current monthly SIP (₹)" value={currentMonthlySip} setValue={setCurrentMonthlySip} step={5000} />
        <NumberField label="Existing corpus (₹)" value={existingCorpus} setValue={setExistingCorpus} step={100000} />
        <NumberField label="Corpus return (%)" value={corpusReturnPct} setValue={setCorpusReturnPct} step={0.5} />
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Goals (future cost)</div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-end gap-2 flex-wrap">
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Goal</span>
                <input value={row.name} onChange={(e) => update(row.id, { name: e.target.value })} className="input-base text-sm w-40" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Future cost (₹)</span>
                <input type="number" step={100000} value={row.futureCost} onChange={(e) => update(row.id, { futureCost: clampNum(e.target.value) })} className="input-base text-sm w-36" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Years away</span>
                <input type="number" step={1} value={row.yearsAway} onChange={(e) => update(row.id, { yearsAway: clampNum(e.target.value) })} className="input-base text-sm w-24" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Return %</span>
                <input type="number" step={0.5} value={row.returnPct} onChange={(e) => update(row.id, { returnPct: clampNum(e.target.value) })} className="input-base text-sm w-20" /></label>
              <button type="button" onClick={() => remove(row.id)} className="text-rose-500 hover:text-rose-700 pb-1.5 print:hidden" aria-label="Remove"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add goal</button>
        </div>
      </div>

      {clientName && <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>}

      {/* Score dial */}
      <div className="flex items-center gap-5 rounded-xl border border-border p-4">
        <div className={`grid place-items-center size-24 rounded-full text-2xl font-bold ${tone === "emerald" ? "bg-emerald-50 text-emerald-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
          {s}
        </div>
        <div>
          <div className={`text-lg font-semibold ${tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700"}`}>{verdict}</div>
          <div className="text-sm text-muted-foreground">Feasibility score out of 100 · savings rate {result.savingsRatePct.toFixed(0)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Required monthly (all goals)" value={inr(result.requiredMonthlyTotal)} />
        <Stat label="Covered by existing corpus" value={inr(result.corpusCoversMonthlyEquivalent)} />
        <Stat label="Net required / available" value={`${inr(result.netRequiredMonthly)} / ${inr(result.availableMonthly)}`} />
        <Stat label="Monthly gap" value={inr(result.gapMonthly)} tone={result.gapMonthly > 0 ? "rose" : "emerald"} />
      </div>

      <Insight tone={tone}>
        {result.gapMonthly > 0
          ? <>To fully fund every goal, the plan needs about <strong>{inr(result.netRequiredMonthly)}/month</strong> but only{" "}
            <strong>{inr(result.availableMonthly)}</strong> is being invested — a <strong>{inr(result.gapMonthly)}/month</strong> gap.
            Closing it (or extending timelines / trimming goals) lifts the score.</>
          : <>The current {inr(result.availableMonthly)}/month plan fully covers all goals — the household is comfortably on track.</>}
      </Insight>
    </div>
  );
}
