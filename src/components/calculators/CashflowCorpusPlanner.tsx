"use client";

/**
 * Cashflow & Corpus Planner — renamed from the reference "Multipurpose
 * Calculator". Combines an accumulation choice (Lumpsum / SIP / Step-up SIP)
 * with a periodic fund-value projection and/or a monthly-SWP analysis (maximum
 * sustainable, or a custom withdrawal), across several withdrawal start ages.
 *
 * Math: src/lib/calculators/multipurpose.ts (verified to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeMultipurpose, type CalcType, type WithdrawalOption, type ReportType,
} from "@/lib/calculators/multipurpose";
import {
  inr, fmtPct, Field, NumberField, TextField, Segmented, Section, Stat, Table, Insight,
} from "./ui";

export function CashflowCorpusPlanner() {
  const [beneficiary, setBeneficiary] = useState("");
  const [currentAge, setCurrentAge] = useState(40);
  const [calcType, setCalcType] = useState<CalcType>("lumpsum");
  const [amount, setAmount] = useState(10000000); // ₹1 cr lumpsum default
  const [stepUpPct, setStepUpPct] = useState(10);
  const [withdrawal, setWithdrawal] = useState<WithdrawalOption>("both");
  const [ratePct, setRatePct] = useState(12);
  const [reportTillAge, setReportTillAge] = useState(90);
  const [reportType, setReportType] = useState<ReportType>("fund_value");
  const [customMonthly, setCustomMonthly] = useState(100000);
  const [reportHeader, setReportHeader] = useState("");

  const amountLabel =
    calcType === "lumpsum" ? "One-time investment (₹)" : "Monthly SIP (₹)";

  const result = useMemo(
    () =>
      computeMultipurpose({
        currentAge, reportTillAge, ratePct, calcType, amount,
        stepUpPct, withdrawal, reportType, customMonthly,
      }),
    [currentAge, reportTillAge, ratePct, calcType, amount, stepUpPct, withdrawal, reportType, customMonthly]
  );

  const showSwp = withdrawal === "swp" || withdrawal === "both";

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Cashflow &amp; Corpus Planner</h2>
        <p className="text-xs text-muted-foreground">
          One investment, many views — project fund value over time and/or the
          monthly income (SWP) it can sustain till a chosen age, with flexible
          withdrawal timing.
        </p>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Beneficiary name (optional)">
          <ClientNameField value={beneficiary} onChange={setBeneficiary} />
        </Field>
        <NumberField label="Current age (yrs)" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Report period till age (yrs)" value={reportTillAge} setValue={setReportTillAge} step={1} />
      </div>

      <Segmented
        label="Calculation type"
        value={calcType}
        onChange={setCalcType}
        options={[
          { value: "lumpsum", label: "Lumpsum" },
          { value: "sip", label: "SIP" },
          { value: "stepup", label: "Step-up SIP" },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label={amountLabel} value={amount} setValue={setAmount} step={calcType === "lumpsum" ? 100000 : 1000} />
        {calcType === "stepup" && (
          <NumberField label="Annual step-up (%)" value={stepUpPct} setValue={setStepUpPct} step={1} />
        )}
        <NumberField label="Assumed return (% p.a.)" value={ratePct} setValue={setRatePct} step={0.5} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Segmented
          label="Withdrawal option"
          value={withdrawal}
          onChange={setWithdrawal}
          options={[
            { value: "periodic", label: "Periodic (fund value)" },
            { value: "swp", label: "Monthly SWP" },
            { value: "both", label: "Periodic + SWP" },
          ]}
        />
        {showSwp && (
          <Segmented
            label="SWP report type"
            value={reportType}
            onChange={setReportType}
            options={[
              { value: "fund_value", label: "Max sustainable SWP" },
              { value: "custom_withdrawal", label: "Custom withdrawal" },
            ]}
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {showSwp && reportType === "custom_withdrawal" && (
          <NumberField label="Custom monthly withdrawal (₹)" value={customMonthly} setValue={setCustomMonthly} step={5000} />
        )}
        <TextField label="Report header (optional)" value={reportHeader} setValue={setReportHeader} placeholder="e.g. My Financial Plan" />
      </div>

      {/* Report title */}
      {(reportHeader || beneficiary) && (
        <div className="border-t pt-3">
          {reportHeader && <div className="text-base font-semibold">{reportHeader}</div>}
          {beneficiary && (
            <div className="text-sm text-muted-foreground">
              Prepared for <span className="text-primary font-medium">{beneficiary}</span> · age {currentAge} · {fmtPct(ratePct)} assumed return · till age {reportTillAge}
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Total invested" value={inr(result.finalInvested)} />
        <Stat label={`Fund value at age ${reportTillAge} (no withdrawal)`} value={inr(result.finalFundValue)} tone="emerald" />
        <Stat label="Horizon" value={`${result.totalYears} yrs`} />
      </div>

      {/* 1. Fund value projection */}
      {result.fundProjection && result.fundProjection.length > 0 && (
        <Section n={1} title="Fund value projection (no withdrawals)">
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Age", "Years", "Invested", "Fund value"]}
              rows={result.fundProjection.map((r) => [
                `${r.age}`,
                `${r.years}`,
                inr(r.invested),
                inr(r.fundValue),
              ])}
            />
          </div>
          <Insight>
            With no withdrawals, the corpus compounds uninterrupted — ideal for legacy and long-term wealth creation.
          </Insight>
        </Section>
      )}

      {/* 2. Max sustainable SWP */}
      {result.swpTable && result.swpTable.length > 0 && (
        <Section n={2} title={`Maximum monthly SWP (sustained till age ${reportTillAge})`}>
          <Table
            head={["Start withdrawals", "Corpus at start", "Max monthly SWP", "Total withdrawn"]}
            rows={result.swpTable.map((r) => [
              r.deferYears === 0 ? `Now (age ${r.startAge})` : `Age ${r.startAge} (+${r.deferYears}y)`,
              inr(r.corpus),
              inr(r.maxSwp),
              inr(r.totalWithdrawn),
            ])}
          />
          <Insight tone="cyan">
            Delaying withdrawals lets the corpus grow first, so a later start sustains a much higher monthly income.
          </Insight>
        </Section>
      )}

      {/* 2b. Custom withdrawal depletion */}
      {result.customTable && result.customTable.length > 0 && (
        <Section n={2} title={`Custom withdrawal of ${inr(customMonthly)}/mo (till age ${reportTillAge})`}>
          <Table
            head={["Start withdrawals", "Corpus at start", "Outcome", "Balance at end"]}
            rows={result.customTable.map((r) => [
              r.deferYears === 0 ? `Now (age ${r.startAge})` : `Age ${r.startAge} (+${r.deferYears}y)`,
              inr(r.corpus),
              r.sustained ? `Sustains till ${reportTillAge}` : `Runs out at age ${r.lastsTillAge}`,
              r.sustained ? inr(r.endBalance) : "—",
            ])}
          />
          <Insight tone={result.customTable.some((r) => !r.sustained) ? "rose" : "emerald"}>
            {result.customTable.every((r) => r.sustained)
              ? `${inr(customMonthly)}/month is sustainable for every start age shown.`
              : `At ${inr(customMonthly)}/month, earlier start ages may exhaust the corpus before age ${reportTillAge} — a later start or lower withdrawal keeps it sustainable.`}
          </Insight>
        </Section>
      )}
    </div>
  );
}
