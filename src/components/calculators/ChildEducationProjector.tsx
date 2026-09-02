"use client";

/**
 * Child Education Cost Projector — projects each education milestone at
 * education inflation (≈10%) and the SIP/lumpsum needed.
 * Math: src/lib/calculators/child-education.ts.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import { computeChildEducation, type EduMilestone } from "@/lib/calculators/child-education";
import { inr, fmtPct, clampNum, NumberField, Field, Section, Stat, Table, Insight } from "./ui";

let nextId = 1;
type Row = EduMilestone & { id: number };
const mk = (name: string, age: number, cost: number): Row => ({ id: nextId++, name, childAgeAtStart: age, currentCost: cost });

export function ChildEducationProjector() {
  const [clientName, setClientName] = useState("");
  const [childCurrentAge, setChildCurrentAge] = useState(3);
  const [eduInflationPct, setEduInflationPct] = useState(10);
  const [expectedReturnPct, setExpectedReturnPct] = useState(12);
  const [existingSavings, setExistingSavings] = useState(0);
  const [rows, setRows] = useState<Row[]>(() => [
    mk("Undergraduate", 18, 2500000),
    mk("Post-graduate", 22, 4000000),
  ]);

  const result = useMemo(
    () => computeChildEducation({ childCurrentAge, eduInflationPct, expectedReturnPct, existingSavings, milestones: rows }),
    [childCurrentAge, eduInflationPct, expectedReturnPct, existingSavings, rows]
  );

  function update(id: number, patch: Partial<Row>) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() { setRows((prev) => [...prev, mk("New course", 24, 1000000)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Child Education Cost Projector</h2>
        <p className="text-xs text-muted-foreground">
          Education costs rise ~10%/yr — faster than general inflation. Project each
          milestone at education inflation and the SIP needed to fund it on time.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Child's current age" value={childCurrentAge} setValue={setChildCurrentAge} step={1} />
        <NumberField label="Education inflation (%)" value={eduInflationPct} setValue={setEduInflationPct} step={0.5} />
        <NumberField label="Expected return (%)" value={expectedReturnPct} setValue={setExpectedReturnPct} step={0.5} />
        <NumberField label="Savings already earmarked (₹)" value={existingSavings} setValue={setExistingSavings} step={100000} />
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Education milestones</div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-end gap-2 flex-wrap">
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Course</span>
                <input value={row.name} onChange={(e) => update(row.id, { name: e.target.value })} className="input-base text-sm w-40" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Starts at child age</span>
                <input type="number" value={row.childAgeAtStart} step={1} onChange={(e) => update(row.id, { childAgeAtStart: clampNum(e.target.value) })} className="input-base text-sm w-28" /></label>
              <label className="block"><span className="text-[10px] text-muted-foreground block mb-0.5">Cost today (₹)</span>
                <input type="number" value={row.currentCost} step={100000} onChange={(e) => update(row.id, { currentCost: clampNum(e.target.value) })} className="input-base text-sm w-36" /></label>
              <button type="button" onClick={() => remove(row.id)} className="text-rose-500 hover:text-rose-700 pb-1.5 print:hidden" aria-label="Remove"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add milestone</button>
        </div>
      </div>

      {clientName && <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Total future cost" value={inr(result.totalFutureCost)} tone="cyan" />
        <Stat label="Total monthly SIP needed" value={inr(result.totalMonthlySip)} tone="emerald" />
        <Stat label="Or lumpsum today" value={inr(result.totalLumpsum)} />
      </div>

      <Section n="✓" title="Per-milestone plan">
        <Table
          head={["Course", "Years away", "Future cost", "Monthly SIP", "Lumpsum today"]}
          rows={result.milestones.map((m) => [m.name, `${m.yearsAway}`, inr(m.futureCost), `${inr(m.monthlySip)}/mo`, inr(m.lumpsum)])}
        />
      </Section>

      <Insight tone="amber">
        At {fmtPct(eduInflationPct)} education inflation, today&apos;s {inr(rows.reduce((s, r) => s + r.currentCost, 0))} of course fees become{" "}
        <strong>{inr(result.totalFutureCost)}</strong> by the time they&apos;re due. Starting now means just{" "}
        <strong>{inr(result.totalMonthlySip)}/month</strong>{existingSavings > 0 && <> (after the {inr(result.existingSavingsFutureValue)} your earmarked savings will grow to)</>} — wait a few years and that figure climbs sharply.
      </Insight>
    </div>
  );
}
