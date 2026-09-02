"use client";

/**
 * Goal Planner — renamed from the reference "Goal Calculator". For one or more
 * future goals, shows the investment needed via Lumpsum / Monthly SIP /
 * Limited-period SIP / Lumpsum+SIP, using an allocation-weighted return. Adds a
 * portfolio roll-up across all goals. Math: src/lib/calculators/goal-planner.ts
 * (verified to the rupee against the multi-goal case study).
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import {
  computeGoal, portfolioReturn, type CostBasis, type Allocation, type Rates,
} from "@/lib/calculators/goal-planner";
import { inr, fmtPct, clampNum, NumberField, Field, Segmented, Table, Insight } from "./ui";

type Goal = {
  id: number;
  purpose: string;
  costBasis: CostBasis;
  cost: number;
  inflationPct: number;
  periodYears: number;
  alloc: Allocation;
  rates: Rates;
  limitedYears: number;
  comboLumpsum: number;
};

let nextId = 1;
const newGoal = (purpose: string, cost: number, period: number, limited: number): Goal => ({
  id: nextId++,
  purpose,
  costBasis: "future",
  cost,
  inflationPct: 6,
  periodYears: period,
  alloc: { debt: 0, hybrid: 0, equity: 100 },
  rates: { debt: 6, hybrid: 9, equity: 12 },
  limitedYears: limited,
  comboLumpsum: 500000,
});

export function GoalPlannerCalculator() {
  const [clientName, setClientName] = useState("");
  const [goals, setGoals] = useState<Goal[]>(() => [
    newGoal("Child Education", 5000000, 15, 10),
    newGoal("Retirement Corpus", 100000000, 25, 20),
  ]);

  function update(id: number, patch: Partial<Goal>) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }
  function updateAlloc(id: number, key: keyof Allocation, v: number) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, alloc: { ...g.alloc, [key]: v } } : g)));
  }
  function updateRate(id: number, key: keyof Rates, v: number) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, rates: { ...g.rates, [key]: v } } : g)));
  }
  function addGoal() { setGoals((prev) => [...prev, newGoal("New Goal", 2500000, 10, 7)]); }
  function removeGoal(id: number) { setGoals((prev) => (prev.length <= 1 ? prev : prev.filter((g) => g.id !== id))); }

  const results = useMemo(() => goals.map((g) => ({ goal: g, res: computeGoal(g) })), [goals]);

  const totalLumpsum = results.reduce((s, r) => s + r.res.lumpsum, 0);
  const totalMonthlySip = results.reduce((s, r) => s + r.res.monthlySip, 0);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Goal Planner</h2>
        <p className="text-xs text-muted-foreground">
          What to invest today to reach future goals — as a lumpsum, a monthly
          SIP, a limited-period SIP, or a lumpsum + SIP combination. Add multiple
          goals for a full plan.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
      </div>

      {/* Portfolio roll-up */}
      {goals.length > 1 && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 grid grid-cols-2 md:grid-cols-3 gap-3 print:bg-transparent">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">All goals — total lumpsum</div>
            <div className="text-lg font-semibold">{inr(totalLumpsum)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">All goals — total monthly SIP</div>
            <div className="text-lg font-semibold">{inr(totalMonthlySip)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Goals</div>
            <div className="text-lg font-semibold">{goals.length}</div>
          </div>
        </div>
      )}

      {/* Per-goal cards */}
      {results.map(({ goal: g, res }, idx) => {
        const allocTotal = g.alloc.debt + g.alloc.hybrid + g.alloc.equity;
        const allocBad = Math.abs(allocTotal - 100) > 0.01;
        return (
          <div key={g.id} className="rounded-xl border border-border p-4 space-y-3 break-inside-avoid">
            <div className="flex items-center justify-between gap-2">
              <input
                value={g.purpose}
                onChange={(e) => update(g.id, { purpose: e.target.value })}
                placeholder="Purpose of investment"
                className="input-base text-sm font-semibold flex-1"
              />
              {goals.length > 1 && (
                <button type="button" onClick={() => removeGoal(g.id)} className="text-rose-500 hover:text-rose-700 print:hidden" aria-label="Remove goal">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Segmented
                label="Cost basis"
                value={g.costBasis}
                onChange={(v) => update(g.id, { costBasis: v })}
                options={[
                  { value: "future", label: "Future cost" },
                  { value: "current", label: "Current cost" },
                ]}
              />
              <NumberField label={g.costBasis === "future" ? "Future cost (₹)" : "Current cost (₹)"} value={g.cost} setValue={(v) => update(g.id, { cost: v })} step={100000} />
              {g.costBasis === "current" && (
                <NumberField label="Inflation (%)" value={g.inflationPct} setValue={(v) => update(g.id, { inflationPct: v })} step={0.5} />
              )}
              <NumberField label="Period (yrs)" value={g.periodYears} setValue={(v) => update(g.id, { periodYears: v })} step={1} />
              <NumberField label="Limited SIP years" value={g.limitedYears} setValue={(v) => update(g.id, { limitedYears: v })} step={1} />
              <NumberField label="Lumpsum (for combo) (₹)" value={g.comboLumpsum} setValue={(v) => update(g.id, { comboLumpsum: v })} step={100000} />
            </div>

            {/* Allocation + rates */}
            <div className="rounded-lg border border-border/70 p-3 bg-secondary/20 print:bg-transparent grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
              <RateAlloc label="Debt" rate={g.rates.debt} alloc={g.alloc.debt} onRate={(v) => updateRate(g.id, "debt", v)} onAlloc={(v) => updateAlloc(g.id, "debt", v)} />
              <RateAlloc label="Hybrid" rate={g.rates.hybrid} alloc={g.alloc.hybrid} onRate={(v) => updateRate(g.id, "hybrid", v)} onAlloc={(v) => updateAlloc(g.id, "hybrid", v)} />
              <RateAlloc label="Equity" rate={g.rates.equity} alloc={g.alloc.equity} onRate={(v) => updateRate(g.id, "equity", v)} onAlloc={(v) => updateAlloc(g.id, "equity", v)} />
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Allocation total / return</div>
                <div className={`input-base text-sm bg-secondary/40 ${allocBad ? "text-rose-600 font-semibold" : ""}`}>
                  {allocTotal.toFixed(0)}% · {fmtPct(Number(res.returnPct.toFixed(2)))}
                </div>
              </div>
            </div>
            {allocBad && <p className="text-[11px] text-rose-600">Allocation should total 100% (currently {allocTotal.toFixed(0)}%).</p>}

            {/* Result table */}
            <Table
              head={["Investment option", "Amount needed"]}
              rows={[
                [`Lumpsum (one-time, today)`, inr(res.lumpsum)],
                [`Monthly SIP (for ${g.periodYears} yrs)`, `${inr(res.monthlySip)} / mo`],
                [`Limited-period SIP (${res.limitedYears} yrs, then grows)`, `${inr(res.limitedSip)} / mo`],
                [`Lumpsum ${inr(res.comboLumpsum)} + Monthly SIP`, `${inr(res.comboSip)} / mo`],
              ]}
            />
            <div className="text-[11px] text-muted-foreground">
              Future cost: <strong>{inr(res.futureCost)}</strong> in {g.periodYears} years
              {g.costBasis === "current" && ` (from ${inr(g.cost)} today at ${fmtPct(g.inflationPct)} inflation)`}
              {" · "}assumed return {fmtPct(Number(res.returnPct.toFixed(2)))}
            </div>
          </div>
        );
      })}

      <button type="button" onClick={addGoal} className="btn-secondary text-xs print:hidden">+ Add new goal</button>

      <Insight tone="cyan">
        Starting early and using SIPs spreads a large goal into affordable monthly amounts — a limited-period SIP can finish investing sooner while the corpus keeps compounding to the target.
      </Insight>
    </div>
  );
}

function RateAlloc({
  label, rate, alloc, onRate, onAlloc,
}: { label: string; rate: number; alloc: number; onRate: (v: number) => void; onAlloc: (v: number) => void }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label} — return % / alloc %</div>
      <div className="flex gap-1">
        <input type="number" step={0.5} min={0} value={rate} onChange={(e) => onRate(clampNum(e.target.value))} className="input-base text-sm w-full" title={`${label} return %`} />
        <input type="number" step={5} min={0} value={alloc} onChange={(e) => onAlloc(clampNum(e.target.value))} className="input-base text-sm w-full" title={`${label} allocation %`} />
      </div>
    </div>
  );
}
