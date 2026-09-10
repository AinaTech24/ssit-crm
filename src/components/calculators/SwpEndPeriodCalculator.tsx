"use client";

/**
 * SWP End Period Calculator — estimates how long a lumpsum or SIP-accumulated
 * corpus lasts when drawn down via SWP (fixed amount or % of corpus, optionally
 * inflation-adjusted). Math: src/lib/calculators/swp-end-period.ts.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeSwpEndPeriod, type InvestmentType, type SwpMode,
} from "@/lib/calculators/swp-end-period";
import {
  inr, fmtPct, NumberField, Field, Toggle, Segmented, Section, Stat, Table, Insight,
} from "./ui";
import { CalcChart } from "./CalcChart";

export function SwpEndPeriodCalculator() {
  const [clientName, setClientName] = useState("");
  const [investmentType, setInvestmentType] = useState<InvestmentType>("sip");
  const [initialInvestment, setInitialInvestment] = useState(25000);
  const [defermentRequired, setDefermentRequired] = useState(true);
  const [defermentYears, setDefermentYears] = useState(20);
  const [accumulationRatePct, setAccumulationRatePct] = useState(12);
  const [swpRatePct, setSwpRatePct] = useState(9);
  const [includeInflation, setIncludeInflation] = useState(false);
  const [inflationPct, setInflationPct] = useState(6);
  const [swpMode, setSwpMode] = useState<SwpMode>("amount");
  const [swpAmount, setSwpAmount] = useState(200000);
  const [swpPercentage, setSwpPercentage] = useState(6);

  const isSip = investmentType === "sip";
  // SIP always needs an accumulation period; lumpsum's deferment is optional.
  const showDeferPeriod = isSip || defermentRequired;

  const result = useMemo(
    () =>
      computeSwpEndPeriod({
        investmentType, initialInvestment,
        defermentRequired: isSip ? true : defermentRequired,
        defermentYears, accumulationRatePct, swpRatePct,
        includeInflation, inflationPct, swpMode, swpAmount, swpPercentage,
      }),
    [investmentType, initialInvestment, defermentRequired, defermentYears, accumulationRatePct, swpRatePct, includeInflation, inflationPct, swpMode, swpAmount, swpPercentage, isSip]
  );

  const durationLabel = result.perpetual
    ? `${result.capYears}+ years (sustains indefinitely)`
    : result.monthsLasted != null
      ? `${Math.floor(result.monthsLasted / 12)} yrs ${result.monthsLasted % 12} mo`
      : "—";

  const tone = result.perpetual ? "emerald" : (result.monthsLasted ?? 0) >= 360 ? "emerald" : (result.monthsLasted ?? 0) >= 180 ? "amber" : "rose";

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">SWP End Period Calculator</h2>
        <p className="text-xs text-muted-foreground">
          How long will the money last? Estimate how many years a lumpsum or
          SIP-built corpus can sustain regular withdrawals (SWP), with optional
          deferment and inflation-rising withdrawals.
        </p>
      </div>

      {/* Accumulation inputs */}
      <Segmented
        label="Investment type"
        value={investmentType}
        onChange={setInvestmentType}
        options={[
          { value: "lumpsum", label: "Lumpsum" },
          { value: "sip", label: "Monthly SIP" },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField
          label={isSip ? "Monthly SIP (₹)" : "Initial investment (₹)"}
          value={initialInvestment}
          setValue={setInitialInvestment}
          step={isSip ? 1000 : 100000}
        />
        {!isSip && (
          <div>
            <Toggle checked={defermentRequired} onChange={setDefermentRequired} label="Deferment before SWP?" />
          </div>
        )}
        {showDeferPeriod && (
          <NumberField
            label={isSip ? "SIP period (yrs)" : "Deferment period (yrs)"}
            value={defermentYears}
            setValue={setDefermentYears}
            step={1}
          />
        )}
        {showDeferPeriod && (
          <NumberField label="Return during SIP/deferment (%)" value={accumulationRatePct} setValue={setAccumulationRatePct} step={0.5} />
        )}
        <NumberField label="Return during SWP (%)" value={swpRatePct} setValue={setSwpRatePct} step={0.5} />
      </div>

      {/* Withdrawal inputs */}
      <div className="rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label="Monthly SWP required"
            value={swpMode}
            onChange={setSwpMode}
            options={[
              { value: "amount", label: "In amount" },
              { value: "percentage", label: "In percentage" },
            ]}
          />
          {swpMode === "amount" ? (
            <NumberField label="Monthly SWP (₹)" value={swpAmount} setValue={setSwpAmount} step={5000} />
          ) : (
            <NumberField label="Annual withdrawal (% of corpus)" value={swpPercentage} setValue={setSwpPercentage} step={0.5} />
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Toggle checked={includeInflation} onChange={setIncludeInflation} label="Inflation-adjusted withdrawal" />
          {includeInflation && (
            <NumberField label="Expected inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />
          )}
        </div>
      </div>

      {clientName && (
        <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Accumulated value (SWP start)" value={inr(result.accumulatedValue)} tone="cyan" />
        <Stat label={swpMode === "amount" ? "Monthly withdrawal" : "Monthly withdrawal (derived)"} value={inr(result.baseMonthlyWithdrawal)} />
        <Stat label="Money lasts" value={durationLabel} tone={tone as any} />
        <Stat label="Total withdrawn" value={inr(result.totalWithdrawn)} />
      </div>

      <Insight tone={tone as any}>
        {result.perpetual ? (
          <>At {inr(result.baseMonthlyWithdrawal)}/month, withdrawals stay below the {fmtPct(swpRatePct)} growth — the corpus is effectively never exhausted (sustains {result.capYears}+ years).</>
        ) : (
          <>The {inr(result.accumulatedValue)} corpus sustains {inr(result.baseMonthlyWithdrawal)}/month
            {includeInflation ? " (rising with inflation)" : ""} for about <strong>{durationLabel}</strong> at a {fmtPct(swpRatePct)} SWP-period return.</>
        )}
      </Insight>

      {/* Year-by-year drawdown */}
      {result.yearRows.length > 0 && (
        <Section n={1} title="Year-by-year drawdown">
          <CalcChart
            data={result.yearRows.map((r) => ({ year: r.year, balance: r.endBalance }))}
            xKey="year"
            series={[{ key: "balance", name: "Corpus balance", color: "#d22e32" }]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Year", "Monthly withdrawal", "Withdrawn that year", "Balance at year-end"]}
              rows={result.yearRows.map((r) => [
                `${r.year}`,
                inr(r.monthlyWithdrawal),
                inr(r.withdrawnThisYear),
                r.endBalance > 0 ? inr(r.endBalance) : "Exhausted",
              ])}
            />
          </div>
        </Section>
      )}
    </div>
  );
}
