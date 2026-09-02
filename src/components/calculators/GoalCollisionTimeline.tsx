"use client";

/**
 * Goal-Collision Timeline — plots all family goals on one timeline and shows the
 * total monthly SIP commitment each year, surfacing the "crunch" years.
 * Math: src/lib/calculators/goal-collision.ts.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import { computeGoalCollision, type CollisionGoal } from "@/lib/calculators/goal-collision";
import { inr, clampNum, NumberField, Field, Section, Stat, Insight } from "./ui";

let nextId = 1;
type Row = CollisionGoal & { id: number };
const mk = (name: string, yearsAway: number, futureCost: number, returnPct: number): Row => ({ id: nextId++, name, yearsAway, futureCost, returnPct });

export function GoalCollisionTimeline() {
  const [clientName, setClientName] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [
    mk("Car upgrade", 3, 1500000, 9),
    mk("Child education", 12, 8000000, 12),
    mk("Home down-payment", 6, 4000000, 11),
    mk("Retirement", 25, 50000000, 12),
  ]);

  const result = useMemo(() => computeGoalCollision(rows), [rows]);

  function update(id: number, patch: Partial<Row>) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() { setRows((prev) => [...prev, mk("New goal", 5, 1000000, 11)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  const maxMonthly = result.peakMonthly || 1;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Goal-Collision Timeline</h2>
        <p className="text-xs text-muted-foreground">
          Every goal demands a monthly SIP. Stack them on one timeline to see the
          years where multiple goals overlap and the household&apos;s commitment peaks —
          before the crunch arrives.
        </p>
      </div>


      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Goals</div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-end gap-2 flex-wrap">
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Goal</span>
                <input value={row.name} onChange={(e) => update(row.id, { name: e.target.value })} className="input-base text-sm w-40" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Years away</span>
                <input type="number" value={row.yearsAway} step={1} onChange={(e) => update(row.id, { yearsAway: clampNum(e.target.value) })} className="input-base text-sm w-24" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Future cost (₹)</span>
                <input type="number" value={row.futureCost} step={100000} onChange={(e) => update(row.id, { futureCost: clampNum(e.target.value) })} className="input-base text-sm w-36" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Return %</span>
                <input type="number" value={row.returnPct} step={0.5} onChange={(e) => update(row.id, { returnPct: clampNum(e.target.value) })} className="input-base text-sm w-20" /></label>
              <button type="button" onClick={() => remove(row.id)} className="text-rose-500 hover:text-rose-700 pb-1.5 print:hidden" aria-label="Remove"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add goal</button>
        </div>
      </div>

      {clientName && <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Peak monthly commitment" value={inr(result.peakMonthly)} tone="rose" />
        <Stat label="Crunch starts in year" value={`${result.peakYear}`} tone="amber" />
        <Stat label="Goals" value={`${result.goals.length}`} />
      </div>

      {/* Per-goal required SIPs */}
      <Section n={1} title="Required monthly SIP per goal">
        <div className="space-y-1">
          {result.goals.map((g) => (
            <div key={g.name} className="flex items-center justify-between text-sm border-b border-border/40 py-1">
              <span className="font-medium">{g.name}</span>
              <span className="text-muted-foreground">{g.yearsAway}y · {inr(g.futureCost)}</span>
              <span className="tabular-nums font-semibold">{inr(g.monthlySip)}/mo</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Timeline bars */}
      <Section n={2} title="Total monthly outflow by year">
        <div className="space-y-1">
          {result.timeline.map((y) => {
            const pct = (y.totalMonthly / maxMonthly) * 100;
            const isPeak = y.year === result.peakYear;
            return (
              <div key={y.year} className="flex items-center gap-2 text-xs">
                <span className="w-10 text-right text-muted-foreground">Y{y.year}</span>
                <div className="flex-1 h-5 bg-secondary/40 rounded overflow-hidden">
                  <div className={`h-full ${isPeak ? "bg-rose-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-28 tabular-nums text-right font-medium">{inr(y.totalMonthly)}/mo</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Insight tone="amber">
        The household&apos;s monthly investment commitment peaks at <strong>{inr(result.peakMonthly)}/month</strong> around year{" "}
        {result.peakYear}, when {result.timeline[result.peakYear - 1]?.activeGoals.length ?? 0} goals run together. Planning for this
        crunch now — staggering goals or front-loading the nearer ones — avoids a cash-flow squeeze later.
      </Insight>
    </div>
  );
}
