"use client";

/**
 * Prosperity Multiplier (SIP → SWP) — accumulate via a step-up SIP, then draw a
 * growing inflation-indexed income for decades while the corpus keeps compounding.
 * Faithful to the "Prosperity Multiplier SIP" worksheet (dual year-by-year
 * ledgers), plus a combined growth chart, the multiplier headline and a
 * depletion check.
 *
 * Math: @/lib/calculators/prosperity-multiplier.
 */

import { useMemo, useState } from "react";
import { inr, NumberField, Section, Stat, Table, Insight } from "./ui";
import { LinesChart, inrShort } from "./charts";
import { computeProsperityMultiplier } from "@/lib/calculators/prosperity-multiplier";

export function ProsperityMultiplier() {
  // Accumulation
  const [monthlySip, setMonthlySip] = useState(50000);
  const [investYears, setInvestYears] = useState(20);
  const [accumRatePct, setAccumRatePct] = useState(12);
  const [sipStepUpPct, setSipStepUpPct] = useState(0);
  const [lumpsum, setLumpsum] = useState(0);
  // Distribution
  const [monthlyWithdrawal, setMonthlyWithdrawal] = useState(200000);
  const [withdrawalYears, setWithdrawalYears] = useState(40);
  const [withdrawRatePct, setWithdrawRatePct] = useState(12);
  const [inflationPct, setInflationPct] = useState(6);

  const res = useMemo(
    () =>
      computeProsperityMultiplier({
        monthlySip,
        investYears,
        accumRatePct,
        sipStepUpPct,
        lumpsum,
        monthlyWithdrawal,
        withdrawalYears,
        withdrawRatePct,
        inflationPct,
      }),
    [monthlySip, investYears, accumRatePct, sipStepUpPct, lumpsum, monthlyWithdrawal, withdrawalYears, withdrawRatePct, inflationPct]
  );

  const grows = res.endingCorpus >= res.totalCorpus;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Prosperity Multiplier (SIP → SWP)</h2>
        <p className="text-xs text-muted-foreground">
          Build a corpus with a SIP, then draw a growing monthly income for decades — and see whether the corpus keeps
          multiplying even while it pays you. The classic &ldquo;invest, then live off it forever&rdquo; story.
        </p>
      </div>

      <Section n={1} title="Accumulation — build the corpus">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={5000} />
          <NumberField label="Investment period (yrs)" value={investYears} setValue={setInvestYears} step={1} />
          <NumberField label="Expected return (% p.a.)" value={accumRatePct} setValue={setAccumRatePct} step={0.5} />
          <NumberField label="Annual SIP step-up (%)" value={sipStepUpPct} setValue={setSipStepUpPct} step={5} />
          <NumberField label="Lumpsum at start (₹)" value={lumpsum} setValue={setLumpsum} step={100000} />
        </div>
      </Section>

      <Section n={2} title="Distribution — draw the income">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumberField label="Monthly withdrawal (₹)" value={monthlyWithdrawal} setValue={setMonthlyWithdrawal} step={5000} />
          <NumberField label="Withdrawal period (yrs)" value={withdrawalYears} setValue={setWithdrawalYears} step={1} />
          <NumberField label="Corpus return (% p.a.)" value={withdrawRatePct} setValue={setWithdrawRatePct} step={0.5} />
          <NumberField label="Income inflation (% p.a.)" value={inflationPct} setValue={setInflationPct} step={0.5} />
        </div>
      </Section>

      <Section n={3} title="The headline">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={`Invested (${investYears}y)`} value={inr(res.totalInvested)} />
          <Stat label={`Corpus at year ${investYears}`} value={inr(res.totalCorpus)} tone="cyan" />
          <Stat label={`Total income drawn (${withdrawalYears}y)`} value={inr(res.totalWithdrawn)} tone="emerald" />
          <Stat
            label={res.depletedYear ? `Corpus runs out` : `Corpus after ${withdrawalYears}y`}
            value={res.depletedYear ? `Year ${investYears + res.depletedYear}` : inr(res.endingCorpus)}
            tone={res.depletedYear ? "rose" : grows ? "emerald" : "amber"}
          />
        </div>
        {res.depletedYear ? (
          <Insight tone="rose">
            The corpus is <strong>exhausted in year {investYears + res.depletedYear}</strong> ({res.depletedYear} years into
            withdrawals). Reduce the monthly withdrawal, lengthen the SIP, or add a step-up to make the income last.
          </Insight>
        ) : (
          <Insight tone={grows ? "emerald" : "amber"}>
            {inr(monthlySip)}/month for {investYears} years ({inr(res.totalInvested)} invested) builds{" "}
            <strong>{inr(res.totalCorpus)}</strong>. Then drawing {inr(monthlyWithdrawal)}/month (rising {inflationPct}%/yr)
            pays out <strong>{inr(res.totalWithdrawn)}</strong> over {withdrawalYears} years — and the corpus{" "}
            {grows ? "still grows to" : "ends at"} <strong>{inr(res.endingCorpus)}</strong>
            {grows ? " while paying you the whole time." : "."}
          </Insight>
        )}
      </Section>

      <Section n={4} title="Corpus over the full journey">
        <LinesChart
          ariaLabel="Corpus across accumulation and withdrawal"
          height={210}
          xLabels={res.series.map((p) => `Yr ${p.year}`)}
          fmtY={(v) => inrShort(v)}
          lines={[{ label: "Corpus", color: "#0E2557", values: res.series.map((p) => p.value) }]}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Years 1–{investYears} are the SIP phase; from year {investYears + 1} the corpus pays the monthly income.
        </p>
      </Section>

      <Section n={5} title="Accumulation ledger (year by year)">
        <Table
          head={["Year", "Opening", "Investment", "Interest", "Closing"]}
          rows={res.accum.map((r) => [
            String(r.year),
            inr(r.openingBal),
            inr(r.investment),
            inr(r.interest),
            inr(r.closingBal),
          ])}
          highlightLastRow
        />
      </Section>

      <Section n={6} title="Withdrawal ledger (year by year)">
        <Table
          head={["Year", "Corpus", "Withdrawal", "Interest", "Closing"]}
          rows={res.draw.map((r) => [
            String(investYears + r.year),
            inr(r.corpus),
            inr(r.withdrawal),
            inr(r.interest),
            inr(Math.max(0, r.closingBal)),
          ])}
          highlightLastRow
        />
      </Section>

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Accumulation: opening balance compounds annually and each year&apos;s SIP is grown to year-end
        (monthly compounding), with the chosen annual step-up. Distribution: the corpus earns the chosen return each year and
        the income rises with inflation. Returns are not guaranteed and vary with markets; taxes and exit loads are not
        modelled. Not investment advice — mutual fund investments are subject to market risks.
      </p>
    </div>
  );
}
