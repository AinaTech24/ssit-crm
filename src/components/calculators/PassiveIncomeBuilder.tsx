"use client";

/**
 * Passive Income / Financial-Freedom Builder — "I want ₹X/month without working."
 * Reverse-engineers the corpus needed and the SIP to build it by the freedom year.
 * Math: src/lib/calculators/advisory.ts → passiveIncome.
 */

import { useMemo, useState } from "react";
import { passiveIncome } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Segmented, Stat, Insight } from "./ui";
import { inrShort } from "./charts";

const PAYOUT = [
  { value: "0", label: "Forever (never touch principal)" },
  { value: "30", label: "For 30 years" },
  { value: "25", label: "For 25 years" },
];

export function PassiveIncomeBuilder() {
  const [clientName, setClientName] = useState("");
  const [targetMonthly, setTargetMonthly] = useState(100000);
  const [inflation, setInflation] = useState(6);
  const [postReturn, setPostReturn] = useState(9);
  const [yearsToFreedom, setYearsToFreedom] = useState(15);
  const [existing, setExisting] = useState(0);
  const [buildReturn, setBuildReturn] = useState(12);
  const [payout, setPayout] = useState("0");

  const res = useMemo(
    () =>
      passiveIncome({
        targetMonthlyToday: targetMonthly,
        inflationPct: inflation,
        postReturnPct: postReturn,
        yearsToFreedom,
        existingCorpus: existing,
        buildReturnPct: buildReturn,
        payoutYears: Number(payout),
      }),
    [targetMonthly, inflation, postReturn, yearsToFreedom, existing, buildReturn, payout],
  );

  const freedomYear = new Date().getFullYear() + yearsToFreedom;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Financial-Freedom Builder</h2>
        <p className="text-xs text-muted-foreground">
          Pick the passive income you want — see the corpus it takes and the SIP that gets you there.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Income wanted today (₹/mo)" value={targetMonthly} setValue={setTargetMonthly} step={5000} />
        <NumberField label="Years to freedom" value={yearsToFreedom} setValue={setYearsToFreedom} step={1} />
        <NumberField label="Already invested (₹)" value={existing} setValue={setExisting} step={100000} />
        <NumberField label="Build return (% p.a.)" value={buildReturn} setValue={setBuildReturn} step={0.5} />
        <NumberField label="Post-freedom return (% p.a.)" value={postReturn} setValue={setPostReturn} step={0.5} />
        <NumberField label="Inflation (% p.a.)" value={inflation} setValue={setInflation} step={0.5} />
        <div className="md:col-span-2">
          <Segmented label="Income should last" value={payout} onChange={setPayout} options={PAYOUT} />
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
          Invest this much every month
        </div>
        <div className="text-3xl font-extrabold text-emerald-700 mt-1">{inr(Math.round(res.requiredSip))}/mo</div>
        <div className="text-xs text-muted-foreground mt-1">
          {clientName ? `${clientName} is` : "You're"} financially free in {freedomYear}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label={`Income in ${yearsToFreedom} yrs`} value={`${inr(Math.round(res.futureMonthly))}/mo`} tone="cyan" />
        <Stat label="Corpus needed" value={inrShort(res.corpusNeeded)} tone="emerald" />
        <Stat label="Monthly SIP" value={inr(Math.round(res.requiredSip))} tone="emerald" />
      </div>

      <Insight tone="emerald">
        To draw <strong>{inr(targetMonthly)}/month</strong> (≈ {inr(Math.round(res.futureMonthly))}/mo after {inflation}% inflation){" "}
        {Number(payout) === 0 ? "forever, without ever touching the principal" : `for ${payout} years`}, {clientName || "your client"} needs a corpus of{" "}
        <strong>{inrShort(res.corpusNeeded)}</strong> — built with about <strong>{inr(Math.round(res.requiredSip))}/month</strong> for {yearsToFreedom} years.
      </Insight>
    </div>
  );
}
