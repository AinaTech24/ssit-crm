"use client";

/**
 * Emergency Fund Planner — the first thing every client should set up: a
 * months-of-expenses buffer, where to park it, and the SIP to build it.
 * Math: src/lib/calculators/advisory.ts → emergencyFund.
 */

import { useMemo, useState } from "react";
import { emergencyFund } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Segmented, Stat, Insight } from "./ui";
import { inrShort } from "./charts";

const BUFFERS = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

export function EmergencyFundPlanner() {
  const [clientName, setClientName] = useState("");
  const [expense, setExpense] = useState(60000);
  const [buffer, setBuffer] = useState("6");
  const [existing, setExisting] = useState(50000);
  const [buildMonths, setBuildMonths] = useState(12);
  const [parkReturn, setParkReturn] = useState(6);

  const res = useMemo(
    () =>
      emergencyFund({
        monthlyExpense: expense,
        monthsBuffer: Number(buffer),
        existing,
        buildMonths,
        parkReturnPct: parkReturn,
      }),
    [expense, buffer, existing, buildMonths, parkReturn],
  );

  const funded = res.gap <= 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Emergency Fund Planner</h2>
        <p className="text-xs text-muted-foreground">
          The financial seatbelt — before any goal investing. How big it should be, and how fast to build it.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Monthly expenses (₹)" value={expense} setValue={setExpense} step={5000} />
        <NumberField label="Already set aside (₹)" value={existing} setValue={setExisting} step={25000} />
        <NumberField label="Build over (months)" value={buildMonths} setValue={setBuildMonths} step={1} />
        <NumberField label="Parking return (% p.a.)" value={parkReturn} setValue={setParkReturn} step={0.5} />
        <div>
          <Segmented label="Buffer size" value={buffer} onChange={setBuffer} options={BUFFERS} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Target fund" value={inrShort(res.target)} tone="cyan" />
        <Stat label="Still needed" value={funded ? "Fully funded ✓" : inrShort(res.gap)} tone={funded ? "emerald" : "amber"} />
        <Stat label="Monthly SIP" value={funded ? "—" : `${inr(Math.round(res.requiredSip))}/mo`} tone="emerald" />
      </div>

      <Insight tone={funded ? "emerald" : "cyan"}>
        {funded ? (
          <>
            {clientName || "Your client"} already has the {buffer}-month buffer of {inrShort(res.target)} covered — now goal-investing
            can begin with confidence.
          </>
        ) : (
          <>
            A {buffer}-month safety net is <strong>{inrShort(res.target)}</strong>. {clientName || "Your client"} can build the{" "}
            {inrShort(res.gap)} gap with about <strong>{inr(Math.round(res.requiredSip))}/month</strong> over {buildMonths} months.
          </>
        )}
      </Insight>

      <Insight tone="amber">
        Park it where it&rsquo;s safe and instantly accessible — a liquid or arbitrage fund / sweep-in FD, <strong>not</strong> equity.
        The emergency fund&rsquo;s job is availability, not growth.
      </Insight>
    </div>
  );
}
