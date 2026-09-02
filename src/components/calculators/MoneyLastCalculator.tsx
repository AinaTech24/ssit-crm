"use client";

/**
 * Will My Money Last? — the retirement reality check. Simulates an
 * inflation-stepped withdrawal against a corpus and shows the age the money
 * runs out vs. life expectancy: a red/green urgency gauge. Math: conversion.ts → moneyLast.
 */

import { useMemo, useState } from "react";
import { moneyLast } from "@/lib/calculators/conversion";
import { inr, NumberField, Field, Stat, Insight, Table } from "./ui";
import { LinesChart, inrShort } from "./charts";

export function MoneyLastCalculator() {
  const [clientName, setClientName] = useState("");
  const [corpus, setCorpus] = useState(30000000);
  const [currentAge, setCurrentAge] = useState(60);
  const [withdrawal, setWithdrawal] = useState(150000);
  const [returnPct, setReturnPct] = useState(8);
  const [withdrawalInflation, setWithdrawalInflation] = useState(6);
  const [lifeExpectancy, setLifeExpectancy] = useState(85);

  const res = useMemo(
    () =>
      moneyLast({
        corpus,
        currentAge,
        monthlyWithdrawal: withdrawal,
        annualReturnPct: returnPct,
        withdrawalInflationPct: withdrawalInflation,
        lifeExpectancy,
      }),
    [corpus, currentAge, withdrawal, returnPct, withdrawalInflation, lifeExpectancy],
  );

  const ok = res.lastsForLife;
  const shortfallYears =
    res.runsOutAge != null && !ok ? Math.max(0, lifeExpectancy - res.runsOutAge) : 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Will My Money Last?</h2>
        <p className="text-xs text-muted-foreground">
          A retirement reality check — does the corpus outlive the client, or run dry first?
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Retirement corpus (₹)" value={corpus} setValue={setCorpus} step={500000} />
        <NumberField label="Current age" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Monthly withdrawal (₹)" value={withdrawal} setValue={setWithdrawal} step={5000} />
        <NumberField label="Return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="Withdrawal step-up (% p.a.)" value={withdrawalInflation} setValue={setWithdrawalInflation} step={0.5} />
        <NumberField label="Life expectancy (age)" value={lifeExpectancy} setValue={setLifeExpectancy} step={1} />
      </div>

      <div
        className={`rounded-xl border p-5 text-center ${
          ok ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/60"
        }`}
      >
        <div className={`text-[11px] uppercase tracking-wider font-semibold ${ok ? "text-emerald-700" : "text-rose-700"}`}>
          {ok ? "The money outlives the plan" : "The money runs out early"}
        </div>
        <div className={`text-3xl font-extrabold mt-1 ${ok ? "text-emerald-700" : "text-rose-700"}`}>
          {res.runsOutAge == null
            ? "Lasts for life ✓"
            : ok
              ? `Lasts to age ${Math.floor(res.runsOutAge)} ✓`
              : `Runs out at age ${Math.floor(res.runsOutAge)}`}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {ok
            ? `Beyond the planned life expectancy of ${lifeExpectancy}.`
            : `That's ${shortfallYears.toFixed(0)} years short of the planned ${lifeExpectancy}.`}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Starting corpus" value={inrShort(corpus)} tone="cyan" />
        <Stat label="First-year withdrawal" value={`${inr(withdrawal)}/mo`} />
        <Stat
          label="Lasts for"
          value={`${res.yearsLasted.toFixed(0)} yrs`}
          tone={ok ? "emerald" : "rose"}
        />
      </div>

      <LinesChart
        ariaLabel="Corpus balance over age"
        height={200}
        xLabels={res.series.map((p) => `Age ${Math.round(p.age)}`)}
        fmtY={(v) => inrShort(v)}
        lines={[{ label: "Corpus balance", color: ok ? "#10b981" : "#f43f5e", values: res.series.map((p) => p.balance) }]}
      />

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
          Year-by-year — withdrawals &amp; balance left
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
          <Table
            head={["Age", "Opening balance", "Withdrawn (year)", "Growth", "Balance after withdrawal"]}
            rows={res.schedule.map((s) => [
              `Age ${Math.round(s.age)}`,
              inrShort(s.opening),
              inrShort(s.withdrawn),
              inrShort(s.growth),
              inrShort(s.balance),
            ])}
            highlightLastRow
          />
        </div>
      </div>

      <Insight tone={ok ? "emerald" : "rose"}>
        {ok ? (
          <>
            With {inrShort(corpus)} earning {returnPct}% and a {inr(withdrawal)}/month withdrawal (stepped up{" "}
            {withdrawalInflation}%/yr), {clientName || "the client"} is covered for life.
          </>
        ) : (
          <>
            At {inr(withdrawal)}/month (stepped up {withdrawalInflation}%/yr), the corpus runs dry at age{" "}
            <strong>{Math.floor(res.runsOutAge!)}</strong> — {shortfallYears.toFixed(0)} years too soon. A larger corpus, a lower
            withdrawal, or a higher-return allocation closes the gap.
          </>
        )}
      </Insight>
    </div>
  );
}
