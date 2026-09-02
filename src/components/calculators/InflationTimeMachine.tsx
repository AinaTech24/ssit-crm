"use client";

/**
 * Inflation Time Machine — "₹X in year A is worth ₹Y in year B." Works forward
 * (today → future) and backward (past → today). The viral wake-up on why cash
 * loses and why you must invest. Math: src/lib/calculators/advisory.ts → timeMachine.
 */

import { useMemo, useState } from "react";
import { timeMachine } from "@/lib/calculators/advisory";
import { inr, NumberField, Field } from "./ui";
import { inrShort } from "./charts";

export function InflationTimeMachine() {
  const thisYear = useMemo(() => new Date().getFullYear(), []);
  const [amount, setAmount] = useState(5000000);
  const [fromYear, setFromYear] = useState(thisYear);
  const [toYear, setToYear] = useState(thisYear + 20);
  const [inflation, setInflation] = useState(6);

  const res = useMemo(
    () => timeMachine({ amount, fromYear, toYear, inflationPct: inflation }),
    [amount, fromYear, toYear, inflation],
  );

  const forward = toYear >= fromYear;
  // Fun fixed reference items, projected over the same span.
  const items = [
    { label: "🎬 Movie ticket", base: 250 },
    { label: "⛽ Petrol (1 litre)", base: 105 },
    { label: "🥛 Litre of milk", base: 66 },
    { label: "🏠 ₹1 Cr today", base: 10000000 },
  ];

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Inflation Time Machine</h2>
        <p className="text-xs text-muted-foreground">
          See what money is really worth across the years — why &ldquo;safe&rdquo; cash quietly loses, and growth investing wins.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Amount (₹)" value={amount} setValue={setAmount} step={100000} />
        <Field label="From year">
          <input
            type="number"
            value={fromYear}
            onChange={(e) => setFromYear(Number(e.target.value) || thisYear)}
            className="input-base text-sm w-full"
          />
        </Field>
        <Field label="To year">
          <input
            type="number"
            value={toYear}
            onChange={(e) => setToYear(Number(e.target.value) || thisYear)}
            className="input-base text-sm w-full"
          />
        </Field>
        <NumberField label="Inflation (% p.a.)" value={inflation} setValue={setInflation} step={0.5} />
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/10 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-primary">
          {inr(amount)} in {fromYear} {forward ? "will need to be" : "had the buying power of"}
        </div>
        <div className="text-3xl font-extrabold text-primary mt-1">{inr(Math.round(res.equivalent))}</div>
        <div className="text-xs text-muted-foreground mt-1">
          to buy the same things in {toYear} ({Math.abs(res.years)} years {forward ? "later" : "earlier"})
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
          The same span, on everyday things
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {items.map((it) => {
            const future = it.base * Math.pow(1 + inflation / 100, toYear - fromYear);
            return (
              <div key={it.label} className="border rounded-md p-2.5">
                <div className="text-muted-foreground">{it.label}</div>
                <div className="font-semibold mt-0.5">
                  {it.base >= 100000 ? inrShort(it.base) : inr(it.base)} → {it.base >= 100000 ? inrShort(future) : inr(Math.round(future))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {inflation > 0 && (
        <div className="text-xs rounded-md border px-3 py-2 text-amber-800 bg-amber-50/70 border-amber-200">
          At {inflation}% inflation, money kept idle loses roughly half its value every ~{Math.round(72 / inflation)} years. Beating
          inflation isn&rsquo;t optional — it&rsquo;s the whole point of investing.
        </div>
      )}
    </div>
  );
}
