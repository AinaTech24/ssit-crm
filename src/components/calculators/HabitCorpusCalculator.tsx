"use client";

/**
 * Small Habit, Big Corpus (the Chai / Latte Factor) — turns a tiny recurring
 * spend into the corpus it could have become. The classic relatable wake-up.
 * Math: src/lib/calculators/conversion.ts → habitToCorpus (reuses fvSip).
 */

import { useMemo, useState } from "react";
import { habitToCorpus } from "@/lib/calculators/conversion";
import { inr, NumberField, Field, Segmented, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

type Freq = "daily" | "weekly" | "monthly";
const FREQ: { value: Freq; label: string; perMonth: number }[] = [
  { value: "daily", label: "Per day", perMonth: 30 },
  { value: "weekly", label: "Per week", perMonth: 4.333 },
  { value: "monthly", label: "Per month", perMonth: 1 },
];
const PRESETS = [
  { label: "☕ Chai/Coffee", amount: 150, freq: "daily" as Freq },
  { label: "🚬 Cigarettes", amount: 300, freq: "daily" as Freq },
  { label: "🍔 Eating out", amount: 2000, freq: "weekly" as Freq },
  { label: "📺 OTT/Subscriptions", amount: 1500, freq: "monthly" as Freq },
];

export function HabitCorpusCalculator() {
  const [clientName, setClientName] = useState("");
  const [amount, setAmount] = useState(150);
  const [freq, setFreq] = useState<Freq>("daily");
  const [returnPct, setReturnPct] = useState(12);
  const [years, setYears] = useState(30);

  const perMonth = FREQ.find((f) => f.value === freq)!.perMonth;
  const res = useMemo(
    () => habitToCorpus({ monthlyAmount: amount * perMonth, annualReturnPct: returnPct, years }),
    [amount, perMonth, returnPct, years],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Small Habit, Big Corpus</h2>
        <p className="text-xs text-muted-foreground">
          What a tiny daily spend becomes if you invest it instead. Pick a habit — or enter your own.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setAmount(p.amount);
              setFreq(p.freq);
            }}
            className="chip text-xs bg-slate-100 hover:bg-primary/10"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Amount (₹)" value={amount} setValue={setAmount} step={50} />
        <div>
          <Segmented label="Frequency" value={freq} onChange={(v) => setFreq(v)} options={FREQ} />
        </div>
        <NumberField label="Years invested" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="That's per month" value={inr(Math.round(res.monthly))} tone="cyan" />
        <Stat label="If you just spend it" value={inr(res.spent)} tone="rose" />
        <Stat label={`If you invest it (${years} yrs)`} value={inr(Math.round(res.corpus))} tone="emerald" />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Spent & gone", value: res.spent, color: "#f43f5e" },
          { label: "Invested instead", value: res.corpus, color: "#10b981" },
        ]}
      />

      <Insight tone="emerald">
        {clientName ? `${clientName}'s` : "That"} {inr(amount)} {FREQ.find((f) => f.value === freq)!.label.toLowerCase()} habit is{" "}
        <strong>{inr(Math.round(res.monthly))}/month</strong>. Invested at {returnPct}% for {years} years it becomes{" "}
        <strong>{inrShort(res.corpus)}</strong> — a <strong>{inrShort(res.gain)}</strong> wealth gain over simply spending it.
      </Insight>
    </div>
  );
}
