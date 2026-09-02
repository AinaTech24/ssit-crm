"use client";

/**
 * Market-Crash Stress Test — what a crash does to a goal, and the cost of
 * panic-selling vs staying invested. Math: src/lib/calculators/crash-stress.ts.
 * A behavioural-coaching tool for volatile markets.
 */

import { useMemo, useState } from "react";
import { computeCrashStress } from "@/lib/calculators/crash-stress";
import { inr, fmtPct, NumberField, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

export function CrashStressTest() {
  const [monthlySip, setMonthlySip] = useState(25000);
  const [lumpsum, setLumpsum] = useState(0);
  const [years, setYears] = useState(20);
  const [expectedReturnPct, setExpectedReturnPct] = useState(12);
  const [crashYear, setCrashYear] = useState(5);
  const [crashPct, setCrashPct] = useState(40);
  const [fdRatePct, setFdRatePct] = useState(6);

  const r = useMemo(
    () => computeCrashStress({ monthlySip, lumpsum, years, expectedReturnPct, crashYear, crashPct, fdRatePct }),
    [monthlySip, lumpsum, years, expectedReturnPct, crashYear, crashPct, fdRatePct]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Market-Crash Stress Test</h2>
        <p className="text-xs text-muted-foreground">
          What happens to a goal when the market crashes mid-journey — and the real
          cost of panic-selling versus staying invested and SI-ing through it.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        <NumberField label="Initial lumpsum (₹)" value={lumpsum} setValue={setLumpsum} step={50000} />
        <NumberField label="Horizon (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (%)" value={expectedReturnPct} setValue={setExpectedReturnPct} step={0.5} />
        <NumberField label="Crash hits in year" value={crashYear} setValue={setCrashYear} step={1} />
        <NumberField label="Crash severity (% drop)" value={crashPct} setValue={setCrashPct} step={5} />
        <NumberField label="Panic-park rate (FD %)" value={fdRatePct} setValue={setFdRatePct} step={0.5} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Stayed invested" value={inr(r.finalStay)} tone="emerald" />
        <Stat label="No-crash baseline" value={inr(r.finalNoCrash)} />
        <Stat label="Panic-sold (→ FD)" value={inr(r.finalPanic)} tone="rose" />
        <Stat label="Cost of panic" value={inr(r.costOfPanic)} tone="rose" />
      </div>

      <Insight tone="emerald">
        A <strong>{fmtPct(crashPct)}</strong> crash in year {crashYear} wipes about{" "}
        <strong>{inr(r.crashDropAmount)}</strong> off the corpus on paper —{" "}
        {r.recoveryMonths != null
          ? <>but staying invested recovers the lost ground in about <strong>{Math.round(r.recoveryMonths / 12 * 10) / 10} years</strong> and still reaches <strong>{inr(r.finalStay)}</strong>.</>
          : <>and recovery continues through the horizon to <strong>{inr(r.finalStay)}</strong>.</>}
        {" "}Panic-selling and parking in an FD instead would leave just <strong>{inr(r.finalPanic)}</strong> — a{" "}
        <strong>{inr(r.costOfPanic)}</strong> mistake.
      </Insight>

      <Section n={1} title="Corpus path (year-by-year)">
        <CalcChart
          data={r.series.filter((p) => p.month % 12 === 0).map((p) => ({ year: p.month / 12, stay: p.stay, noCrash: p.noCrash, panic: p.panic }))}
          xKey="year"
          series={[
            { key: "stay", name: "Stayed invested", color: "#10b981" },
            { key: "noCrash", name: "No crash", color: "#94a3b8" },
            { key: "panic", name: "Panic-sold", color: "#ef4444" },
          ]}
        />
        <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
          <Table
            head={["Year", "Stayed invested", "No crash", "Panic-sold"]}
            rows={r.series.filter((p) => p.month % 12 === 0).map((p) => [
              `${p.month / 12}`,
              inr(p.stay),
              inr(p.noCrash),
              inr(p.panic),
            ])}
          />
        </div>
      </Section>
      <p className="text-[10px] text-muted-foreground">Illustration of behaviour, not a market forecast. Crashes and recoveries vary.</p>
    </div>
  );
}
