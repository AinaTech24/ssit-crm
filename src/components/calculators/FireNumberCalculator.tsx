"use client";

/**
 * FIRE / Financial-Independence Number — the corpus that buys freedom and the
 * earliest age the client reaches it. Math: src/lib/calculators/fire.ts.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeFire } from "@/lib/calculators/fire";
import { inr, fmtPct, NumberField, Field, Stat, Insight } from "./ui";

export function FireNumberCalculator() {
  const [clientName, setClientName] = useState("");
  const [currentAge, setCurrentAge] = useState(32);
  const [monthlyExpenseNow, setMonthlyExpenseNow] = useState(80000);
  const [inflationPct, setInflationPct] = useState(6);
  const [preReturnPct, setPreReturnPct] = useState(12);
  const [postReturnPct, setPostReturnPct] = useState(8);
  const [currentCorpus, setCurrentCorpus] = useState(2000000);
  const [monthlySip, setMonthlySip] = useState(50000);
  const [sipStepUpPct, setSipStepUpPct] = useState(8);
  const [swrPct, setSwrPct] = useState(4);
  const [lifeExpectancy, setLifeExpectancy] = useState(90);

  const r = useMemo(
    () => computeFire({ currentAge, monthlyExpenseNow, inflationPct, preReturnPct, postReturnPct, currentCorpus, monthlySip, sipStepUpPct, swrPct, lifeExpectancy }),
    [currentAge, monthlyExpenseNow, inflationPct, preReturnPct, postReturnPct, currentCorpus, monthlySip, sipStepUpPct, swrPct, lifeExpectancy]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">FIRE — Financial Independence Number</h2>
        <p className="text-xs text-muted-foreground">
          The corpus that lets your client live off investments — and the earliest
          age they reach it on their current savings plan.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Current age" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Monthly expenses now (₹)" value={monthlyExpenseNow} setValue={setMonthlyExpenseNow} step={5000} />
        <NumberField label="Current corpus (₹)" value={currentCorpus} setValue={setCurrentCorpus} step={100000} />
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={5000} />
        <NumberField label="SIP step-up (%/yr)" value={sipStepUpPct} setValue={setSipStepUpPct} step={1} />
        <NumberField label="Pre-FI return (%)" value={preReturnPct} setValue={setPreReturnPct} step={0.5} />
        <NumberField label="Post-FI return (%)" value={postReturnPct} setValue={setPostReturnPct} step={0.5} />
        <NumberField label="Inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />
        <NumberField label="Safe withdrawal rate (%)" value={swrPct} setValue={setSwrPct} step={0.5} />
        <NumberField label="Life expectancy" value={lifeExpectancy} setValue={setLifeExpectancy} step={1} />
      </div>

      {clientName && <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="FIRE number (today's terms)" value={inr(r.fireNumberToday)} tone="cyan" />
        <Stat label="Financial-independence age" value={r.fireAge != null ? `${r.fireAge}` : "Beyond horizon"} tone={r.fireAge != null ? "emerald" : "rose"} />
        <Stat label="Years to FI" value={r.yearsToFire != null ? `${r.yearsToFire} yrs` : "—"} />
        <Stat label="Corpus needed at FI" value={r.fireCorpus != null ? inr(r.fireCorpus) : "—"} />
      </div>

      {r.fireAge != null ? (
        <Insight tone={r.sustainsToLifeExpectancy ? "emerald" : "amber"}>
          On the current plan, {clientName || "your client"} reaches financial independence at age{" "}
          <strong>{r.fireAge}</strong> ({r.yearsToFire} years away) with a corpus of{" "}
          <strong>{inr(r.corpusAtFire ?? 0)}</strong> — enough to draw {fmtPct(swrPct)}/yr for living costs.
          {r.sustainsToLifeExpectancy
            ? <> This corpus sustains inflation-rising expenses all the way to age {lifeExpectancy}.</>
            : <> ⚠ At {fmtPct(postReturnPct)} post-FI return, expenses outpace the corpus around age {r.shortfallAge} — consider a higher SWR buffer, longer accumulation, or a larger corpus.</>}
        </Insight>
      ) : (
        <Insight tone="rose">
          The current savings plan doesn&apos;t reach financial independence within the horizon to age {lifeExpectancy}.
          Increasing the SIP, the step-up, or the return assumption brings the FI age into reach.
        </Insight>
      )}
      <p className="text-[10px] text-muted-foreground">SWR rule is a planning heuristic; sequence-of-returns risk and taxes can change outcomes.</p>
    </div>
  );
}
