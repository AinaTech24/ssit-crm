"use client";

/**
 * Old vs New Tax Regime Optimizer (FY 2025-26) — which regime saves more, and
 * the SIP the saving could fund. Math: src/lib/calculators/tax-regime.ts.
 */

import { useMemo, useState } from "react";
import { compareRegimes } from "@/lib/calculators/tax-regime";
import { inr, fmtPct, NumberField, Toggle, Section, Stat, Table, Insight } from "./ui";

export function TaxRegimeOptimizer() {
  const [grossIncome, setGrossIncome] = useState(1500000);
  const [isSalaried, setIsSalaried] = useState(true);
  const [section80C, setSection80C] = useState(150000);
  const [section80D, setSection80D] = useState(25000);
  const [nps80CCD1B, setNps80CCD1B] = useState(50000);
  const [homeLoanInterest, setHomeLoanInterest] = useState(0);
  const [hraExemption, setHraExemption] = useState(0);
  const [otherDeductions, setOtherDeductions] = useState(0);
  const [employerNps, setEmployerNps] = useState(0);
  const [sipReturnPct, setSipReturnPct] = useState(12);
  const [sipYears, setSipYears] = useState(20);

  const result = useMemo(
    () =>
      compareRegimes({
        grossIncome, isSalaried,
        deductions: { section80C, section80D, nps80CCD1B, homeLoanInterest, hraExemption, otherDeductions, employerNps80CCD2: employerNps },
        sipReturnPct, sipYears,
      }),
    [grossIncome, isSalaried, section80C, section80D, nps80CCD1B, homeLoanInterest, hraExemption, otherDeductions, employerNps, sipReturnPct, sipYears]
  );

  const better = result.betterRegime;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Old vs New Tax Regime Optimizer <span className="text-xs font-normal text-muted-foreground">(FY 2025-26)</span></h2>
        <p className="text-xs text-muted-foreground">
          Which regime costs your client less tax — and how much wealth the saving
          builds if invested as an SIP.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Gross annual income (₹)" value={grossIncome} setValue={setGrossIncome} step={50000} />
        <div className="flex items-end"><Toggle checked={isSalaried} onChange={setIsSalaried} label="Salaried (standard deduction)" /></div>
        <NumberField label="Employer NPS 80CCD(2) (₹)" value={employerNps} setValue={setEmployerNps} step={10000} />
      </div>

      <div className="rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Deductions (old regime only)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumberField label="80C (max ₹1.5L)" value={section80C} setValue={setSection80C} step={10000} />
          <NumberField label="80D health insurance" value={section80D} setValue={setSection80D} step={5000} />
          <NumberField label="80CCD(1B) NPS (max ₹50k)" value={nps80CCD1B} setValue={setNps80CCD1B} step={5000} />
          <NumberField label="Home loan interest (max ₹2L)" value={homeLoanInterest} setValue={setHomeLoanInterest} step={25000} />
          <NumberField label="HRA exemption" value={hraExemption} setValue={setHraExemption} step={25000} />
          <NumberField label="Other deductions" value={otherDeductions} setValue={setOtherDeductions} step={10000} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Old regime tax" value={inr(result.old.totalTax)} tone={better === "old" ? "emerald" : undefined} />
        <Stat label="New regime tax" value={inr(result.new.totalTax)} tone={better === "new" ? "emerald" : undefined} />
        <Stat label="Better regime" value={better === "new" ? "New" : "Old"} tone="cyan" />
        <Stat label="Annual tax saving" value={inr(result.annualSaving)} tone="emerald" />
      </div>

      <Section n="✓" title="Side-by-side">
        <Table
          head={["Component", "Old regime", "New regime"]}
          rows={[
            ["Taxable income", inr(result.old.taxableIncome), inr(result.new.taxableIncome)],
            ["Income tax (pre-rebate)", inr(result.old.baseTax), inr(result.new.baseTax)],
            ["Less: 87A rebate", `(${inr(result.old.rebate)})`, `(${inr(result.new.rebate)})`],
            ["Surcharge", inr(result.old.surcharge), inr(result.new.surcharge)],
            ["Health & education cess 4%", inr(result.old.cess), inr(result.new.cess)],
            ["Total tax", inr(result.old.totalTax), inr(result.new.totalTax)],
          ]}
          highlightCol={better === "new" ? 2 : 1}
        />
      </Section>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="SIP return (%)" value={sipReturnPct} setValue={setSipReturnPct} step={0.5} />
        <NumberField label="SIP years" value={sipYears} setValue={setSipYears} step={1} />
      </div>

      <Insight tone="emerald">
        The <strong>{better === "new" ? "new" : "old"}</strong> regime saves about{" "}
        <strong>{inr(result.annualSaving)}/year</strong>. Invested as a{" "}
        <strong>{inr(result.monthlyFromSaving)}/month</strong> SIP at {fmtPct(sipReturnPct)} for {sipYears} years, that
        tax saving alone grows to <strong>{inr(result.sipFutureValue)}</strong> — turning a tax decision into wealth.
      </Insight>
      <p className="text-[10px] text-muted-foreground">Indicative; surcharge marginal relief and senior-citizen exemptions not modelled. Confirm with a tax advisor.</p>
    </div>
  );
}
