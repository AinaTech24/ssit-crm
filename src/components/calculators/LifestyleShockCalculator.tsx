"use client";

/**
 * Inflation Lifestyle Shock — shows how much a client's *current* lifestyle will
 * cost decades from now, and the corpus needed to sustain it through retirement.
 * A genuine fear-to-action moment. Math: conversion.ts → lifestyleShock.
 */

import { useMemo, useState } from "react";
import { lifestyleShock } from "@/lib/calculators/conversion";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

export function LifestyleShockCalculator() {
  const [clientName, setClientName] = useState("");
  const [monthlyExpense, setMonthlyExpense] = useState(75000);
  const [inflation, setInflation] = useState(6);
  const [yearsToRetire, setYearsToRetire] = useState(25);
  const [retirementYears, setRetirementYears] = useState(25);
  const [postReturn, setPostReturn] = useState(9);

  const res = useMemo(
    () =>
      lifestyleShock({
        monthlyExpenseToday: monthlyExpense,
        inflationPct: inflation,
        yearsToRetire,
        retirementYears,
        postReturnPct: postReturn,
      }),
    [monthlyExpense, inflation, yearsToRetire, retirementYears, postReturn],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Inflation Lifestyle Shock</h2>
        <p className="text-xs text-muted-foreground">
          What today&rsquo;s lifestyle will actually cost at retirement — and the corpus needed to keep living it.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Monthly expense today (₹)" value={monthlyExpense} setValue={setMonthlyExpense} step={5000} />
        <NumberField label="Inflation (% p.a.)" value={inflation} setValue={setInflation} step={0.5} />
        <NumberField label="Years to retirement" value={yearsToRetire} setValue={setYearsToRetire} step={1} />
        <NumberField label="Years in retirement" value={retirementYears} setValue={setRetirementYears} step={1} />
        <NumberField label="Post-retirement return (% p.a.)" value={postReturn} setValue={setPostReturn} step={0.5} />
      </div>

      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-rose-700">
          In {yearsToRetire} years, the same lifestyle costs
        </div>
        <div className="text-3xl font-extrabold text-rose-700 mt-1">{inr(Math.round(res.futureMonthly))}/mo</div>
        <div className="text-xs text-muted-foreground mt-1">
          that&rsquo;s {res.multiple.toFixed(1)}× today&rsquo;s {inr(res.todayMonthly)}/mo
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Today" value={`${inr(res.todayMonthly)}/mo`} />
        <Stat label={`In ${yearsToRetire} yrs`} value={`${inr(Math.round(res.futureMonthly))}/mo`} tone="rose" />
        <Stat label="Corpus to sustain it" value={inrShort(res.corpusNeeded)} tone="emerald" />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Today / month", value: res.todayMonthly, color: "#94a3b8" },
          { label: `At retirement / month`, value: res.futureMonthly, color: "#f43f5e" },
        ]}
      />

      <Insight tone="amber">
        At {inflation}% inflation, {clientName ? `${clientName}'s` : "your"} {inr(res.todayMonthly)}/month lifestyle becomes{" "}
        <strong>{inr(Math.round(res.futureMonthly))}/month</strong> in {yearsToRetire} years. To fund {retirementYears} years of
        that, you&rsquo;ll need a corpus of <strong>{inrShort(res.corpusNeeded)}</strong> — starting today is the cheapest it will ever be.
      </Insight>
    </div>
  );
}
