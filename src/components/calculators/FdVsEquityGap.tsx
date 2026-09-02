"use client";

/**
 * FD vs Equity Wealth Gap — for the FD-hoarder. Same money in a bank FD vs an
 * equity fund, the diverging curves and the wealth "left on the table".
 * Math: src/lib/calculators/conversion.ts → fdVsEquity (reuses fvLumpsum/fvSip).
 */

import { useMemo, useState } from "react";
import { fdVsEquity } from "@/lib/calculators/conversion";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { LinesChart, inrShort } from "./charts";

export function FdVsEquityGap() {
  const [clientName, setClientName] = useState("");
  const [lumpsum, setLumpsum] = useState(1000000);
  const [sip, setSip] = useState(20000);
  const [years, setYears] = useState(20);
  const [fdRate, setFdRate] = useState(6.5);
  const [equityRate, setEquityRate] = useState(12);

  const res = useMemo(
    () => fdVsEquity({ lumpsum, monthlySip: sip, years, fdRatePct: fdRate, equityRatePct: equityRate }),
    [lumpsum, sip, years, fdRate, equityRate],
  );

  const multiple = res.fd > 0 ? res.eq / res.fd : 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">FD vs Equity — the Wealth Gap</h2>
        <p className="text-xs text-muted-foreground">
          The same money, parked in a bank FD versus invested in equity. See the gap your client is leaving on the table.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="One-time lumpsum (₹)" value={lumpsum} setValue={setLumpsum} step={100000} />
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} step={1000} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="FD rate (% p.a.)" value={fdRate} setValue={setFdRate} step={0.25} />
        <NumberField label="Equity return (% p.a.)" value={equityRate} setValue={setEquityRate} step={0.5} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="In a bank FD" value={inr(Math.round(res.fd))} tone="amber" />
        <Stat label="In equity" value={inr(Math.round(res.eq))} tone="emerald" />
        <Stat label="Wealth gap" value={inrShort(res.gap)} tone="rose" />
      </div>

      <LinesChart
        ariaLabel="FD versus equity growth"
        xLabels={res.series.map((p) => `Yr ${p.year}`)}
        fmtY={(v) => inrShort(v)}
        lines={[
          { label: `FD @ ${fdRate}%`, color: "#f59e0b", values: res.series.map((p) => p.fd) },
          { label: `Equity @ ${equityRate}%`, color: "#10b981", values: res.series.map((p) => p.eq) },
        ]}
      />

      <Insight tone="emerald">
        On {inr(res.invested)} invested, equity grows to <strong>{inrShort(res.eq)}</strong> versus{" "}
        <strong>{inrShort(res.fd)}</strong> in an FD over {years} years — about <strong>{multiple.toFixed(1)}×</strong> more, a{" "}
        <strong>{inrShort(res.gap)}</strong> difference. FD interest is also fully taxable at slab rate, widening the real gap.
      </Insight>
    </div>
  );
}
