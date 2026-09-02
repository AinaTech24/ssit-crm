"use client";

/**
 * Crorepati Countdown — the exact month & year a client crosses ₹1 Cr (or 2/5 Cr)
 * given their SIP + lumpsum, with a milestone timeline. A visceral target.
 * Math: src/lib/calculators/conversion.ts (monthsToTarget, reuses verified fvSip/fvLumpsum).
 */

import { useMemo, useState } from "react";
import { monthsToTarget, dateAfterMonths } from "@/lib/calculators/conversion";
import { fvSip, fvLumpsum } from "@/lib/goal-planning/calc";
import { inr, NumberField, Field, Segmented, Section, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

const TARGETS = [
  { value: "10000000", label: "₹1 Crore" },
  { value: "20000000", label: "₹2 Crore" },
  { value: "50000000", label: "₹5 Crore" },
];

export function CrorepatiCountdown() {
  const [clientName, setClientName] = useState("");
  const [sip, setSip] = useState(25000);
  const [lumpsum, setLumpsum] = useState(0);
  const [returnPct, setReturnPct] = useState(12);
  const [target, setTarget] = useState("10000000");

  const today = useMemo(() => new Date(), []);
  const targetNum = Number(target);

  const res = useMemo(() => {
    const months = monthsToTarget({ monthlySip: sip, lumpsum, annualReturnPct: returnPct, target: targetNum });
    const milestones = [1000000, 2500000, 5000000, 10000000, 20000000, 50000000]
      .filter((t) => t <= targetNum)
      .map((t) => {
        const m = monthsToTarget({ monthlySip: sip, lumpsum, annualReturnPct: returnPct, target: t });
        return { amount: t, months: m };
      });
    const invested = months != null ? lumpsum + sip * months : 0;
    const fvAt = months != null ? fvLumpsum(lumpsum, returnPct, months) + fvSip(sip, returnPct, months) : 0;
    return { months, milestones, invested, fvAt };
  }, [sip, lumpsum, returnPct, targetNum]);

  const reached = res.months != null;
  const date = reached ? dateAfterMonths(today, res.months!) : null;
  const years = reached ? (res.months! / 12).toFixed(1) : "—";

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Crorepati Countdown</h2>
        <p className="text-xs text-muted-foreground">
          The exact month your client becomes a crorepati — and the milestones along the way.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} step={1000} />
        <NumberField label="One-time lumpsum (₹)" value={lumpsum} setValue={setLumpsum} step={50000} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <div className="md:col-span-2">
          <Segmented label="Goal" value={target} onChange={setTarget} options={TARGETS} />
        </div>
      </div>

      {reached ? (
        <>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
              {clientName ? `${clientName} becomes a ${inrShort(targetNum)}-aire in` : `You hit ${inrShort(targetNum)} in`}
            </div>
            <div className="text-3xl font-extrabold text-emerald-700 mt-1">{date!.label}</div>
            <div className="text-xs text-muted-foreground mt-1">that&rsquo;s just {years} years from today</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Time to goal" value={`${years} yrs`} tone="cyan" />
            <Stat label="You invest" value={inr(res.invested)} />
            <Stat label="Goal corpus" value={inr(Math.round(res.fvAt))} tone="emerald" />
          </div>

          <Section n={1} title="Milestone timeline">
            <BarsChart
              accent="#0891b2"
              bars={res.milestones.map((m) => ({
                label: inrShort(m.amount),
                value: m.months ?? 0,
                display: m.months != null ? dateAfterMonths(today, m.months).label : "—",
                caption: m.months != null ? `${(m.months / 12).toFixed(1)} yrs` : "—",
              }))}
            />
          </Section>

          <Insight tone="emerald">
            At <strong>{inr(sip)}/month</strong> growing at {returnPct}% p.a., {clientName || "your client"} reaches{" "}
            <strong>{inrShort(targetNum)}</strong> by <strong>{date!.label}</strong> — having invested only{" "}
            {inr(res.invested)}. Every month of delay pushes that date further out.
          </Insight>
        </>
      ) : (
        <Insight tone="amber">
          At these inputs the goal isn&rsquo;t reached within 60 years. Increase the SIP, add a lumpsum, or extend the horizon.
        </Insight>
      )}
    </div>
  );
}
