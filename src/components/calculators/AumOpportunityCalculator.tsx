"use client";

/**
 * AUM Opportunity Calculator - internal RM tool for sizing additional business
 * from one investor/family or a hot lead. It converts wallet-share clues into
 * immediate AUM, SIP upgrade and 5-year book impact.
 */

import { useMemo, useState } from "react";
import { fvLumpsum, fvSip } from "@/lib/goal-planning/calc";
import { BarsChart, inrShort } from "./charts";
import { Field, inr, Insight, NumberField, Segmented, Stat, Table } from "./ui";

type Urgency = "low" | "medium" | "high";
type Tone = "emerald" | "amber" | "rose" | "cyan";

const URGENCY: { value: Urgency; label: string; multiplier: number }[] = [
  { value: "low", label: "Low", multiplier: 0.85 },
  { value: "medium", label: "Medium", multiplier: 1 },
  { value: "high", label: "High", multiplier: 1.2 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toneFor(score: number): Tone {
  if (score >= 75) return "emerald";
  if (score >= 50) return "amber";
  return "rose";
}

export function AumOpportunityCalculator() {
  const [clientName, setClientName] = useState("");
  const [currentAum, setCurrentAum] = useState(5000000);
  const [currentSip, setCurrentSip] = useState(25000);
  const [monthlyIncome, setMonthlyIncome] = useState(300000);
  const [targetSavingsPct, setTargetSavingsPct] = useState(20);
  const [idleCash, setIdleCash] = useState(700000);
  const [fdAmount, setFdAmount] = useState(2500000);
  const [lowYieldInsurance, setLowYieldInsurance] = useState(1000000);
  const [bonusExpected, setBonusExpected] = useState(500000);
  const [familyAssetsOutside, setFamilyAssetsOutside] = useState(4000000);
  const [stoppedSip, setStoppedSip] = useState(15000);
  const [capturePct, setCapturePct] = useState(35);
  const [returnPct, setReturnPct] = useState(11);
  const [urgency, setUrgency] = useState<Urgency>("medium");

  const result = useMemo(() => {
    const investableSavings = (monthlyIncome * targetSavingsPct) / 100;
    const sipUpgrade = Math.max(0, investableSavings - currentSip) + stoppedSip;
    const capture = clamp(capturePct, 0, 100) / 100;
    const urgencyMultiplier = URGENCY.find((u) => u.value === urgency)?.multiplier ?? 1;

    const idleCashOpp = idleCash * Math.min(0.8, capture + 0.15);
    const fdOpp = fdAmount * capture;
    const insuranceOpp = lowYieldInsurance * Math.min(0.65, capture + 0.05);
    const bonusOpp = bonusExpected * Math.min(0.75, capture + 0.1);
    const familyOpp = familyAssetsOutside * Math.min(0.5, capture * 0.75);

    const immediateOpportunity = (idleCashOpp + fdOpp + insuranceOpp + bonusOpp + familyOpp) * urgencyMultiplier;
    const annualSipOpportunity = sipUpgrade * 12;
    const oneYearAum = immediateOpportunity + annualSipOpportunity;
    const fiveYearAum = fvLumpsum(immediateOpportunity, returnPct, 60) + fvSip(sipUpgrade, returnPct, 60);
    const walletShareLiftPct = currentAum <= 0 ? 100 : (oneYearAum / currentAum) * 100;
    const priorityScore = Math.round(clamp(
      Math.log10(Math.max(1, oneYearAum)) * 12 +
      walletShareLiftPct * 0.9 +
      (urgency === "high" ? 15 : urgency === "medium" ? 8 : 0) +
      (sipUpgrade > 0 ? 10 : 0),
      0,
      100,
    ));
    const firstPitch =
      idleCashOpp >= fdOpp && idleCashOpp >= familyOpp ? "Idle money deployment"
        : fdOpp >= familyOpp ? "FD maturity / tax-efficient migration"
          : "Family wallet-share review";

    return {
      investableSavings,
      sipUpgrade,
      idleCashOpp,
      fdOpp,
      insuranceOpp,
      bonusOpp,
      familyOpp,
      immediateOpportunity,
      annualSipOpportunity,
      oneYearAum,
      fiveYearAum,
      walletShareLiftPct,
      priorityScore,
      firstPitch,
    };
  }, [bonusExpected, capturePct, currentAum, currentSip, familyAssetsOutside, fdAmount, idleCash, lowYieldInsurance, monthlyIncome, returnPct, stoppedSip, targetSavingsPct, urgency]);

  const tone = toneFor(result.priorityScore);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">AUM Opportunity Calculator</h2>
        <p className="text-xs text-muted-foreground">
          Size the next-business opportunity from idle money, FDs, stopped SIPs, bonus cash and family wallet share.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Client / family name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <div className="md:col-span-2">
          <Segmented
            label="Urgency"
            value={urgency}
            onChange={setUrgency}
            options={[
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "low", label: "Low" },
            ]}
          />
        </div>
        <NumberField label="Conversion confidence (%)" value={capturePct} setValue={setCapturePct} step={5} />
        <NumberField label="Current MF AUM" value={currentAum} setValue={setCurrentAum} step={100000} />
        <NumberField label="Current SIP / month" value={currentSip} setValue={setCurrentSip} step={1000} />
        <NumberField label="Monthly income" value={monthlyIncome} setValue={setMonthlyIncome} step={10000} />
        <NumberField label="Target saving rate (%)" value={targetSavingsPct} setValue={setTargetSavingsPct} step={1} />
        <NumberField label="Idle bank cash" value={idleCash} setValue={setIdleCash} step={50000} />
        <NumberField label="FD / low-yield corpus" value={fdAmount} setValue={setFdAmount} step={100000} />
        <NumberField label="Insurance maturity / surrender" value={lowYieldInsurance} setValue={setLowYieldInsurance} step={100000} />
        <NumberField label="Bonus / upcoming cash" value={bonusExpected} setValue={setBonusExpected} step={50000} />
        <NumberField label="Family assets outside" value={familyAssetsOutside} setValue={setFamilyAssetsOutside} step={100000} />
        <NumberField label="Stopped SIP / month" value={stoppedSip} setValue={setStoppedSip} step={1000} />
        <NumberField label="Assumed return (%)" value={returnPct} setValue={setReturnPct} step={0.5} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Immediate AUM opportunity" value={inr(result.immediateOpportunity)} tone="emerald" />
        <Stat label="SIP upgrade / month" value={inr(result.sipUpgrade)} tone={result.sipUpgrade > 0 ? "emerald" : "amber"} />
        <Stat label="12-month book impact" value={inr(result.oneYearAum)} tone="cyan" />
        <Stat label="Priority score" value={`${result.priorityScore}/100`} tone={tone} />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Idle cash", value: result.idleCashOpp, color: "#0891b2" },
          { label: "FD", value: result.fdOpp, color: "#f59e0b" },
          { label: "Insurance", value: result.insuranceOpp, color: "#8b5cf6" },
          { label: "Bonus", value: result.bonusOpp, color: "#10b981" },
          { label: "Family", value: result.familyOpp, color: "#6366f1" },
        ]}
      />

      <Table
        head={["Opportunity source", "Estimated capture", "RM angle"]}
        rows={[
          ["Idle bank cash", inr(result.idleCashOpp), "Liquid fund / STP starter conversation"],
          ["FD / low-yield corpus", inr(result.fdOpp), "Post-tax return comparison"],
          ["Insurance maturity / surrender", inr(result.insuranceOpp), "IRR and protection review"],
          ["Bonus / upcoming cash", inr(result.bonusOpp), "Goal-wise lumpsum deployment"],
          ["Family wallet share", inr(result.familyOpp), "Family review meeting"],
          ["SIP upgrade annualised", inr(result.annualSipOpportunity), "Salary-linked step-up SIP"],
        ]}
        highlightLastRow
      />

      <div className="grid md:grid-cols-3 gap-3">
        <Stat label="5-year AUM impact" value={inr(result.fiveYearAum)} tone="emerald" />
        <Stat label="Current investable savings" value={inr(result.investableSavings)} />
        <Stat label="Wallet-share lift in year 1" value={`${result.walletShareLiftPct.toFixed(1)}%`} tone="cyan" />
      </div>

      <Insight tone={tone}>
        {clientName || "This opportunity"} should be prioritised at <strong>{result.priorityScore}/100</strong>. Lead with{" "}
        <strong>{result.firstPitch}</strong>, then close the SIP upgrade of <strong>{inr(result.sipUpgrade)}/month</strong>.
      </Insight>

      <Insight tone="cyan">
        If captured and invested at {returnPct}% p.a., the estimated 5-year book impact is{" "}
        <strong>{inrShort(result.fiveYearAum)}</strong>. Use this as an RM planning estimate, not as a client return promise.
      </Insight>
    </div>
  );
}
