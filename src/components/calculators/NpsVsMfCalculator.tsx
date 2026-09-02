"use client";

/**
 * NPS vs Mutual Fund (retirement) — head-to-head: the tax break + lower cost of
 * NPS against the flexibility of MFs, and the mandatory-annuity drag at 60.
 * Math: src/lib/calculators/advisory.ts → npsVsMf.
 */

import { useMemo, useState } from "react";
import { npsVsMf } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

export function NpsVsMfCalculator() {
  const [clientName, setClientName] = useState("");
  const [monthly, setMonthly] = useState(10000);
  const [years, setYears] = useState(25);
  const [npsReturn, setNpsReturn] = useState(9);
  const [mfReturn, setMfReturn] = useState(12);
  const [annuityRate, setAnnuityRate] = useState(6);
  const [taxSlab, setTaxSlab] = useState(30);

  const res = useMemo(
    () =>
      npsVsMf({
        monthly,
        years,
        npsReturnPct: npsReturn,
        mfReturnPct: mfReturn,
        annuityRatePct: annuityRate,
        taxSlabPct: taxSlab,
      }),
    [monthly, years, npsReturn, mfReturn, annuityRate, taxSlab],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">NPS vs Mutual Fund</h2>
        <p className="text-xs text-muted-foreground">
          Same monthly contribution to retirement: NPS (tax break, lower cost, forced annuity) vs an equity MF (flexible, fully liquid).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Monthly contribution (₹)" value={monthly} setValue={setMonthly} step={1000} />
        <NumberField label="Years to 60" value={years} setValue={setYears} step={1} />
        <NumberField label="NPS return (% p.a.)" value={npsReturn} setValue={setNpsReturn} step={0.5} />
        <NumberField label="MF return (% p.a.)" value={mfReturn} setValue={setMfReturn} step={0.5} />
        <NumberField label="Annuity rate (% p.a.)" value={annuityRate} setValue={setAnnuityRate} step={0.25} />
        <NumberField label="Your tax slab (%)" value={taxSlab} setValue={setTaxSlab} step={5} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="NPS corpus @ 60" value={inr(Math.round(res.npsCorpus))} tone="cyan" />
        <Stat label="MF corpus @ 60" value={inr(Math.round(res.mfCorpus))} tone="emerald" />
        <Stat label="NPS lump (60%)" value={inr(Math.round(res.npsLumpsum))} />
        <Stat label="NPS pension / mo" value={inr(Math.round(res.npsMonthlyPension))} tone="amber" />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "NPS corpus", value: res.npsCorpus, color: "#0891b2" },
          { label: "MF corpus", value: res.mfCorpus, color: "#10b981" },
        ]}
      />

      <Insight tone="emerald">
        MF grows to <strong>{inrShort(res.mfCorpus)}</strong> — fully liquid — vs NPS&rsquo;s <strong>{inrShort(res.npsCorpus)}</strong>,
        of which only 60% ({inrShort(res.npsLumpsum)}) is withdrawable and the rest buys a {annuityRate}% annuity ≈{" "}
        {inr(Math.round(res.npsMonthlyPension))}/mo pension. NPS adds an extra <strong>{inr(Math.round(res.annualNpsTaxSaved))}/yr</strong>{" "}
        tax saving via 80CCD(1B). Best of both: NPS for the tax break, MFs for the flexible bulk.
      </Insight>

      <Insight tone="amber">
        Illustration only. NPS rules (40% annuity, tax treatment) and annuity rates change; equity-MF gains attract LTCG tax on withdrawal.
      </Insight>
    </div>
  );
}
