"use client";

/**
 * Human Life Value Calculator — renamed faithfully from "HLV Calculator".
 * Income Replacement (PV of future income to retirement, net of own expenses)
 * and a standard Need Analysis method. Math: src/lib/calculators/hlv.ts
 * (Income Replacement verified to the reference case → ₹5.64 cr, ₹4.64 cr extra).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeIncomeReplacement, computeNeedAnalysis,
  type HlvMethod, type CoverBasis,
} from "@/lib/calculators/hlv";
import { inr, fmtPct, NumberField, Field, Segmented, Section, Stat, Table, Insight } from "./ui";

export function HumanLifeValueCalculator() {
  const [method, setMethod] = useState<HlvMethod>("income_replacement");
  const [clientName, setClientName] = useState("");

  // Income Replacement
  const [currentAge, setCurrentAge] = useState(30);
  const [retirementAge, setRetirementAge] = useState(60);
  const [discountPct, setDiscountPct] = useState(6);
  const [currentAnnualIncome, setCurrentAnnualIncome] = useState(1500000);
  const [annualPersonalExpenses, setAnnualPersonalExpenses] = useState(300000);
  const [incrementPct, setIncrementPct] = useState(8);
  const [existingCover, setExistingCover] = useState(10000000);
  const [basis, setBasis] = useState<CoverBasis>("gross");

  // Need Analysis
  const [outstandingLiabilities, setOutstandingLiabilities] = useState(5000000);
  const [futureGoals, setFutureGoals] = useState(5000000);
  const [familyAnnualNeed, setFamilyAnnualNeed] = useState(800000);
  const [yearsOfSupport, setYearsOfSupport] = useState(25);
  const [naIncrementPct, setNaIncrementPct] = useState(6);
  const [naDiscountPct, setNaDiscountPct] = useState(7);
  const [existingAssets, setExistingAssets] = useState(3000000);
  const [naExistingCover, setNaExistingCover] = useState(10000000);

  const ir = useMemo(
    () => computeIncomeReplacement({
      currentAge, retirementAge, discountPct, currentAnnualIncome,
      annualPersonalExpenses, incrementPct, existingCover,
    }),
    [currentAge, retirementAge, discountPct, currentAnnualIncome, annualPersonalExpenses, incrementPct, existingCover]
  );

  const na = useMemo(
    () => computeNeedAnalysis({
      outstandingLiabilities, futureGoals, familyAnnualNeed, yearsOfSupport,
      incrementPct: naIncrementPct, discountPct: naDiscountPct, existingAssets, existingCover: naExistingCover,
    }),
    [outstandingLiabilities, futureGoals, familyAnnualNeed, yearsOfSupport, naIncrementPct, naDiscountPct, existingAssets, naExistingCover]
  );

  const hlv = basis === "gross" ? ir.hlvGross : ir.hlvNet;
  const additional = basis === "gross" ? ir.additionalGross : ir.additionalNet;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Human Life Value Calculator</h2>
        <p className="text-xs text-muted-foreground">
          Size the term cover a family needs to stay financially secure — by
          replacing future income, or by adding up specific financial needs.
        </p>
      </div>

      <Segmented
        label="Method"
        value={method}
        onChange={setMethod}
        options={[
          { value: "income_replacement", label: "Income Replacement" },
          { value: "need_analysis", label: "Need Analysis" },
        ]}
      />

      {method === "income_replacement" ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <NumberField label="Current age (yrs)" value={currentAge} setValue={setCurrentAge} step={1} />
            <NumberField label="Retirement age (yrs)" value={retirementAge} setValue={setRetirementAge} step={1} />
            <NumberField label="Current annual income (₹)" value={currentAnnualIncome} setValue={setCurrentAnnualIncome} step={50000} />
            <NumberField label="Annual personal expenses (₹)" value={annualPersonalExpenses} setValue={setAnnualPersonalExpenses} step={25000} />
            <NumberField label="Expected annual increment (%)" value={incrementPct} setValue={setIncrementPct} step={0.5} />
            <NumberField label="Discounting rate (%)" value={discountPct} setValue={setDiscountPct} step={0.5} />
            <NumberField label="Existing life cover (₹)" value={existingCover} setValue={setExistingCover} step={500000} />
          </div>

          <Segmented
            label="Cover basis"
            value={basis}
            onChange={setBasis}
            options={[
              { value: "gross", label: "Replace gross income" },
              { value: "net", label: "Net of own expenses" },
            ]}
          />

          {clientName && (
            <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span> · income protection for {ir.years} years</div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="PV of future income" value={inr(ir.pvIncome)} />
            <Stat label="PV of own expenses" value={inr(ir.pvExpenses)} />
            <Stat label={`Human Life Value (${basis})`} value={inr(hlv)} tone="cyan" />
            <Stat label="Additional cover required" value={inr(additional)} tone="emerald" />
          </div>

          <Table
            head={["Component", "Amount"]}
            rows={[
              [`PV of future income (${fmtPct(incrementPct)} increment, ${fmtPct(discountPct)} discount, ${ir.years} yrs)`, inr(ir.pvIncome)],
              ["Less: PV of own personal expenses", `(${inr(ir.pvExpenses)})`],
              ["Human Life Value — net of self-expenses", inr(ir.hlvNet)],
              ["Human Life Value — gross income", inr(ir.hlvGross)],
              ["Less: existing life cover", `(${inr(existingCover)})`],
              [`Additional term cover required (${basis})`, inr(additional)],
            ]}
          />
          <Insight tone="cyan">
            On a {basis === "gross" ? "gross-income" : "net-of-expenses"} basis, {clientName || "the client"} needs about{" "}
            <strong>{inr(hlv)}</strong> of life cover; with {inr(existingCover)} already in force, that&apos;s{" "}
            <strong>{inr(additional)}</strong> of additional term cover.
          </Insight>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <NumberField label="Outstanding liabilities / loans (₹)" value={outstandingLiabilities} setValue={setOutstandingLiabilities} step={100000} />
            <NumberField label="Future goals — education/marriage (₹)" value={futureGoals} setValue={setFutureGoals} step={100000} />
            <NumberField label="Family annual expense need (₹)" value={familyAnnualNeed} setValue={setFamilyAnnualNeed} step={50000} />
            <NumberField label="Years of support needed" value={yearsOfSupport} setValue={setYearsOfSupport} step={1} />
            <NumberField label="Expense inflation (%)" value={naIncrementPct} setValue={setNaIncrementPct} step={0.5} />
            <NumberField label="Discounting rate (%)" value={naDiscountPct} setValue={setNaDiscountPct} step={0.5} />
            <NumberField label="Existing assets / savings (₹)" value={existingAssets} setValue={setExistingAssets} step={100000} />
            <NumberField label="Existing life cover (₹)" value={naExistingCover} setValue={setNaExistingCover} step={500000} />
          </div>

          <Section n="✓" title="Cover required (Need Analysis)">
            <Table
              head={["Component", "Amount"]}
              rows={[
                ["Outstanding liabilities", inr(outstandingLiabilities)],
                ["Future goals (education / marriage)", inr(futureGoals)],
                [`PV of family's ongoing expenses (${yearsOfSupport} yrs)`, inr(na.pvFamilyNeed)],
                ["Total need", inr(na.totalNeed)],
                ["Less: existing assets + cover", `(${inr(na.offsets)})`],
                ["Cover required", inr(na.coverRequired)],
              ]}
            />
            <Insight tone="emerald">
              By the needs approach, the family requires about <strong>{inr(na.totalNeed)}</strong>; after existing
              assets and cover ({inr(na.offsets)}), a further <strong>{inr(na.coverRequired)}</strong> of cover is needed.
            </Insight>
          </Section>
        </>
      )}
    </div>
  );
}
