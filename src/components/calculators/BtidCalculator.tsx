"use client";

/**
 * BTID — "Buy Term, Invest the Difference" vs a ULIP / endowment / money-back
 * policy. Shows the wealth gap AND the protection gap. The MFD's sharpest
 * insurance cross-sell tool. Math: src/lib/calculators/advisory.ts → btid.
 */

import { useMemo, useState } from "react";
import { btid } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

export function BtidCalculator() {
  const [clientName, setClientName] = useState("");
  const [annualBudget, setAnnualBudget] = useState(100000);
  const [termPremium, setTermPremium] = useState(15000);
  const [termCover, setTermCover] = useState(10000000);
  const [years, setYears] = useState(25);
  const [mfReturn, setMfReturn] = useState(12);
  const [tradReturn, setTradReturn] = useState(5.5);

  const res = useMemo(
    () =>
      btid({
        annualBudget,
        termAnnualPremium: termPremium,
        termCover,
        years,
        mfReturnPct: mfReturn,
        tradReturnPct: tradReturn,
      }),
    [annualBudget, termPremium, termCover, years, mfReturn, tradReturn],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Term + MF vs ULIP / Endowment</h2>
        <p className="text-xs text-muted-foreground">
          Same yearly outgo: a pure term plan + mutual funds, or a traditional/ULIP policy. Compare wealth <em>and</em> cover.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Yearly budget (₹)" value={annualBudget} setValue={setAnnualBudget} step={10000} />
        <NumberField label="Term plan premium / yr (₹)" value={termPremium} setValue={setTermPremium} step={1000} />
        <NumberField label="Term cover (₹)" value={termCover} setValue={setTermCover} step={500000} />
        <NumberField label="Horizon (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="MF return (% p.a.)" value={mfReturn} setValue={setMfReturn} step={0.5} />
        <NumberField label="ULIP/endowment return (% p.a.)" value={tradReturn} setValue={setTradReturn} step={0.5} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Term + MF — corpus" value={inr(Math.round(res.btidCorpus))} tone="emerald" />
        <Stat label="Traditional — corpus" value={inr(Math.round(res.tradCorpus))} tone="amber" />
        <Stat label="Term + MF — cover" value={inrShort(res.btidCover)} tone="emerald" />
        <Stat label="Traditional — cover" value={inrShort(res.tradCover)} tone="rose" />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Term + MF", value: res.btidCorpus, color: "#10b981" },
          { label: "ULIP/Endowment", value: res.tradCorpus, color: "#f59e0b" },
        ]}
      />

      <Insight tone="emerald">
        For the same {inr(annualBudget)}/year, <strong>Term + MF</strong> builds{" "}
        <strong>{inrShort(res.btidCorpus)}</strong> with a full {inrShort(res.btidCover)} cover — versus{" "}
        <strong>{inrShort(res.tradCorpus)}</strong> and only {inrShort(res.tradCover)} cover from a bundled policy. That&rsquo;s{" "}
        <strong>{inrShort(res.wealthGap)}</strong> more wealth <em>and</em> {inrShort(res.coverGap)} more protection — insurance and
        investment do their jobs best when kept separate.
      </Insight>
    </div>
  );
}
