"use client";

/**
 * NPS Retirement & Tax Planner — corpus at 60, tax-free lump (≤60%) + annuity
 * (≥40%) → monthly pension, plus the 80CCD(1B) tax benefit.
 * Math: src/lib/calculators/nps.ts.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeNps } from "@/lib/calculators/nps";
import { inr, fmtPct, NumberField, Field, Section, Stat, Table, Insight } from "./ui";

export function NpsPlanner() {
  const [clientName, setClientName] = useState("");
  const [currentAge, setCurrentAge] = useState(30);
  const [retirementAge, setRetirementAge] = useState(60);
  const [monthlyContribution, setMonthlyContribution] = useState(5000);
  const [annualStepUpPct, setAnnualStepUpPct] = useState(5);
  const [expectedReturnPct, setExpectedReturnPct] = useState(10);
  const [existingCorpus, setExistingCorpus] = useState(0);
  const [annuityPortionPct, setAnnuityPortionPct] = useState(40);
  const [annuityRatePct, setAnnuityRatePct] = useState(6);
  const [taxSlabPct, setTaxSlabPct] = useState(30);

  const r = useMemo(
    () => computeNps({ currentAge, retirementAge, monthlyContribution, annualStepUpPct, expectedReturnPct, existingCorpus, annuityPortionPct, annuityRatePct, taxSlabPct }),
    [currentAge, retirementAge, monthlyContribution, annualStepUpPct, expectedReturnPct, existingCorpus, annuityPortionPct, annuityRatePct, taxSlabPct]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">NPS Retirement &amp; Tax Planner</h2>
        <p className="text-xs text-muted-foreground">
          Project the NPS corpus at retirement, the tax-free lump sum and the
          monthly pension from the mandatory annuity — plus the extra ₹50,000
          80CCD(1B) tax deduction.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Current age" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Retirement age" value={retirementAge} setValue={setRetirementAge} step={1} />
        <NumberField label="Monthly contribution (₹)" value={monthlyContribution} setValue={setMonthlyContribution} step={500} />
        <NumberField label="Annual step-up (%)" value={annualStepUpPct} setValue={setAnnualStepUpPct} step={1} />
        <NumberField label="Expected return (%)" value={expectedReturnPct} setValue={setExpectedReturnPct} step={0.5} />
        <NumberField label="Existing NPS corpus (₹)" value={existingCorpus} setValue={setExistingCorpus} step={50000} />
        <NumberField label="Annuity portion (% ≥ 40)" value={annuityPortionPct} setValue={setAnnuityPortionPct} step={5} />
        <NumberField label="Annuity rate (%)" value={annuityRatePct} setValue={setAnnuityRatePct} step={0.5} />
        <NumberField label="Tax slab (% for 80CCD-1B)" value={taxSlabPct} setValue={setTaxSlabPct} step={5} />
      </div>

      {clientName && <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Corpus at ${retirementAge}`} value={inr(r.corpus)} tone="cyan" />
        <Stat label="Tax-free lump sum" value={inr(r.lumpSum)} tone="emerald" />
        <Stat label="Annuity corpus" value={inr(r.annuityCorpus)} />
        <Stat label="Monthly pension" value={inr(r.monthlyPension)} tone="emerald" />
      </div>

      <Section n="✓" title="At retirement">
        <Table
          head={["Component", "Amount"]}
          rows={[
            [`Total contributed (over ${r.years} yrs)`, inr(r.totalContributed)],
            [`Corpus at age ${retirementAge}`, inr(r.corpus)],
            [`Lump-sum withdrawal (${100 - annuityPortionPct}%, tax-free)`, inr(r.lumpSum)],
            [`Annuity corpus (${annuityPortionPct}%)`, inr(r.annuityCorpus)],
            [`Monthly pension @ ${fmtPct(annuityRatePct)}`, inr(r.monthlyPension)],
          ]}
        />
      </Section>

      <Insight tone="emerald">
        Contributing {inr(monthlyContribution)}/month builds a {inr(r.corpus)} corpus — a {inr(r.lumpSum)} tax-free
        lump sum plus {inr(r.monthlyPension)}/month pension for life. The 80CCD(1B) deduction also saves about{" "}
        <strong>{inr(r.annual80CCD1BBenefit)}</strong> in tax every year, over and above your 80C limit.
      </Insight>
    </div>
  );
}
