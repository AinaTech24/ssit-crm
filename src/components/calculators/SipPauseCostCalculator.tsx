"use client";

/**
 * SIP Pause/Skip Cost — a behaviour nudge: what skipping a few SIPs today
 * really costs at the goal date, because those rupees lose the most compounding.
 * Math: src/lib/calculators/advisory.ts → sipPauseCost.
 */

import { useMemo, useState } from "react";
import { sipPauseCost } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { inrShort } from "./charts";

export function SipPauseCostCalculator() {
  const [clientName, setClientName] = useState("");
  const [sip, setSip] = useState(25000);
  const [returnPct, setReturnPct] = useState(12);
  const [yearsRemaining, setYearsRemaining] = useState(20);
  const [monthsSkipped, setMonthsSkipped] = useState(6);

  const res = useMemo(
    () => sipPauseCost({ monthlySip: sip, returnPct, yearsRemaining, monthsSkipped }),
    [sip, returnPct, yearsRemaining, monthsSkipped],
  );

  const multiple = res.contributed > 0 ? res.costAtHorizon / res.contributed : 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">The Cost of Pausing Your SIP</h2>
        <p className="text-xs text-muted-foreground">
          Skipping a few SIPs feels harmless — but those are the rupees with the most years to compound. See the real damage.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} step={1000} />
        <NumberField label="SIPs skipped (months)" value={monthsSkipped} setValue={setMonthsSkipped} step={1} />
        <NumberField label="Years to goal" value={yearsRemaining} setValue={setYearsRemaining} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
      </div>

      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-rose-700">
          Skipping {monthsSkipped} SIP{monthsSkipped === 1 ? "" : "s"} costs the goal
        </div>
        <div className="text-3xl font-extrabold text-rose-700 mt-1">{inrShort(res.costAtHorizon)}</div>
        <div className="text-xs text-muted-foreground mt-1">
          on just {inr(res.contributed)} of skipped contributions — a {multiple.toFixed(1)}× loss
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Contributions skipped" value={inr(res.contributed)} />
        <Stat label="Lost at goal date" value={inrShort(res.costAtHorizon)} tone="rose" />
      </div>

      <Insight tone="amber">
        Pausing {monthsSkipped} SIP{monthsSkipped === 1 ? "" : "s"} of {inr(sip)} saves {inr(res.contributed)} today, but costs{" "}
        {clientName || "your client"} <strong>{inrShort(res.costAtHorizon)}</strong> at the goal {yearsRemaining} years out — because
        early rupees compound the longest. When money is tight, reduce the SIP rather than stopping it.
      </Insight>
    </div>
  );
}
