"use client";

/**
 * Dream Wedding Planner — the other big family expense. City-style cost presets
 * + inflation → the SIP to fund it from today. Math: advisory.ts → inflatedGoalSip.
 */

import { useMemo, useState } from "react";
import { inflatedGoalSip } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { inrShort } from "./charts";

const PRESETS = [
  { label: "💍 Simple / Court", cost: 1500000 },
  { label: "🎉 Tier-2 city", cost: 3000000 },
  { label: "🏛️ Metro grand", cost: 6000000 },
  { label: "✈️ Destination", cost: 12000000 },
];

export function WeddingPlanner() {
  const [clientName, setClientName] = useState("");
  const [cost, setCost] = useState(3000000);
  const [years, setYears] = useState(15);
  const [inflation, setInflation] = useState(7);
  const [existing, setExisting] = useState(0);
  const [returnPct, setReturnPct] = useState(12);

  const res = useMemo(
    () => inflatedGoalSip({ costToday: cost, years, inflationPct: inflation, existingSavings: existing, returnPct }),
    [cost, years, inflation, existing, returnPct],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Dream Wedding Planner</h2>
        <p className="text-xs text-muted-foreground">
          A wedding the family will remember — funded calmly, starting today. Pick a style or set your own budget.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setCost(p.cost)} className="chip text-xs bg-slate-100 hover:bg-primary/10">
            {p.label} · {inrShort(p.cost)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Whose wedding / name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Wedding cost today (₹)" value={cost} setValue={setCost} step={500000} />
        <NumberField label="Years to wedding" value={years} setValue={setYears} step={1} />
        <NumberField label="Cost inflation (% p.a.)" value={inflation} setValue={setInflation} step={0.5} />
        <NumberField label="Already saved (₹)" value={existing} setValue={setExisting} step={100000} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">Start a SIP of</div>
        <div className="text-3xl font-extrabold text-emerald-700 mt-1">{inr(Math.round(res.requiredSip))}/mo</div>
        <div className="text-xs text-muted-foreground mt-1">for {years} years to fund the big day, stress-free</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label={`Cost in ${years} yrs`} value={inrShort(res.futureCost)} tone="amber" />
        <Stat label="Monthly SIP needed" value={inr(Math.round(res.requiredSip))} tone="emerald" />
      </div>

      <Insight tone="emerald">
        A {inrShort(cost)} wedding today becomes <strong>{inrShort(res.futureCost)}</strong> in {years} years at {inflation}% inflation.
        A SIP of <strong>{inr(Math.round(res.requiredSip))}/month</strong> funds it calmly — instead of breaking an FD or taking a loan at the last minute.
      </Insight>
    </div>
  );
}
