"use client";

/**
 * ₹1 Crore Race — a bar-race of how many years different SIP amounts take to
 * reach the goal, with the client's own SIP highlighted. "How soon do you want
 * your first crore?" Math: conversion.ts → croreRace (reuses monthsToTarget).
 */

import { useMemo, useState } from "react";
import { croreRace, dateAfterMonths } from "@/lib/calculators/conversion";
import { inr, NumberField, Field, Segmented, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

const TARGETS = [
  { value: "10000000", label: "₹1 Crore" },
  { value: "20000000", label: "₹2 Crore" },
  { value: "50000000", label: "₹5 Crore" },
];
const RUNGS = [5000, 10000, 25000, 50000, 100000];

export function CroreRaceCalculator() {
  const [clientName, setClientName] = useState("");
  const [yourSip, setYourSip] = useState(25000);
  const [lumpsum, setLumpsum] = useState(0);
  const [returnPct, setReturnPct] = useState(12);
  const [target, setTarget] = useState("10000000");

  const today = useMemo(() => new Date(), []);
  const targetNum = Number(target);

  const amounts = useMemo(() => {
    const set = new Set<number>([...RUNGS, yourSip].filter((a) => a > 0));
    return Array.from(set).sort((a, b) => a - b);
  }, [yourSip]);

  const race = useMemo(
    () => croreRace({ sipAmounts: amounts, lumpsum, annualReturnPct: returnPct, target: targetNum }),
    [amounts, lumpsum, returnPct, targetNum],
  );

  const yours = race.find((r) => r.sip === yourSip);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">₹1 Crore Race</h2>
        <p className="text-xs text-muted-foreground">
          How soon does your client reach the goal at different SIPs? The bigger the SIP, the sooner the finish line.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Your SIP (₹/mo)" value={yourSip} setValue={setYourSip} step={1000} />
        <NumberField label="One-time lumpsum (₹)" value={lumpsum} setValue={setLumpsum} step={50000} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <div className="md:col-span-2">
          <Segmented label="Goal" value={target} onChange={setTarget} options={TARGETS} />
        </div>
      </div>

      <BarsChart
        bars={race.map((r) => ({
          label: `${inr(r.sip)}/mo`,
          value: r.months != null ? r.months / 12 : 0,
          display: r.months != null ? `${(r.months / 12).toFixed(1)} yrs` : "60+ yrs",
          caption: r.months != null ? dateAfterMonths(today, r.months).label : "—",
          color: r.sip === yourSip ? "#0e2557" : "#0891b2",
        }))}
      />

      <Insight tone="emerald">
        {yours && yours.months != null ? (
          <>
            At <strong>{inr(yourSip)}/month</strong>, {clientName || "your client"} reaches {inrShort(targetNum)} in{" "}
            <strong>{(yours.months / 12).toFixed(1)} years</strong> (by {dateAfterMonths(today, yours.months).label}). Doubling the
            SIP doesn&rsquo;t take half the time — but it gets there meaningfully sooner. Pick the finish line, then the SIP.
          </>
        ) : (
          <>At {inr(yourSip)}/month the goal isn&rsquo;t reached within 60 years — step up the SIP or add a lumpsum.</>
        )}
      </Insight>
    </div>
  );
}
