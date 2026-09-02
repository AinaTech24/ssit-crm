"use client";

/**
 * Insurance Return Analyzer — renamed from the reference "Insurance IRR
 * Calculator". Computes the real IRR of a traditional/guaranteed insurance
 * policy and contrasts it with the same premiums invested in a mutual fund.
 *
 * Math: src/lib/calculators/insurance-irr.ts (verified to the rupee).
 */

import { useMemo, useState } from "react";
import {
  computeInsuranceIrr, type PayoutMode, type Payout,
} from "@/lib/calculators/insurance-irr";
import {
  inr, fmtPct, clampNum, Field, NumberField, TextField, Toggle, Segmented, Section, Stat, Table, Insight,
} from "./ui";

export function InsuranceReturnAnalyzer() {
  const [policyName, setPolicyName] = useState("");
  const [currentAge, setCurrentAge] = useState(38);
  const [annualPremium, setAnnualPremium] = useState(100000);
  const [premiumPaymentTerm, setPremiumPaymentTerm] = useState(10);
  const [policyTerm, setPolicyTerm] = useState(15);
  const [payoutMode, setPayoutMode] = useState<PayoutMode>("maturity");
  const [payouts, setPayouts] = useState<Payout[]>([
    { year: 4, amount: 50000 },
    { year: 8, amount: 50000 },
    { year: 12, amount: 50000 },
  ]);
  const [maturityAmount, setMaturityAmount] = useState(1750000);
  const [showMfCompare, setShowMfCompare] = useState(true);
  const [showMfMaturity, setShowMfMaturity] = useState(true);
  const [expectedReturnPct, setExpectedReturnPct] = useState(12);

  const usePayouts = payoutMode !== "maturity";

  const result = useMemo(
    () =>
      computeInsuranceIrr({
        annualPremium, premiumPaymentTerm, policyTerm, payoutMode,
        payouts, maturityAmount, expectedReturnPct,
      }),
    [annualPremium, premiumPaymentTerm, policyTerm, payoutMode, payouts, maturityAmount, expectedReturnPct]
  );

  function setPayout(i: number, patch: Partial<Payout>) {
    setPayouts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPayout() {
    setPayouts((prev) => [...prev, { year: (prev[prev.length - 1]?.year ?? 0) + 4, amount: 50000 }]);
  }
  function removePayout(i: number) {
    setPayouts((prev) => prev.filter((_, idx) => idx !== i));
  }

  const irrTone =
    result.irrPct == null ? "amber" : result.irrPct < 6 ? "rose" : result.irrPct < 9 ? "amber" : "emerald";

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Insurance Return Analyzer (IRR)</h2>
        <p className="text-xs text-muted-foreground">
          Find the real return (IRR) hidden inside a traditional or guaranteed
          insurance plan — then compare it, rupee-for-rupee, with a mutual fund.
        </p>
      </div>

      {/* Basic policy details */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <TextField label="Policy name (optional)" value={policyName} setValue={setPolicyName} placeholder="e.g. Guaranteed Plan" />
        <NumberField label="Current age (optional)" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Annual premium (₹)" value={annualPremium} setValue={setAnnualPremium} step={5000} />
        <NumberField label="Premium payment term (yrs)" value={premiumPaymentTerm} setValue={setPremiumPaymentTerm} step={1} />
        <NumberField label="Policy term (yrs)" value={policyTerm} setValue={setPolicyTerm} step={1} />
        <NumberField label="Expected maturity amount (₹)" value={maturityAmount} setValue={setMaturityAmount} step={50000} />
      </div>

      <Segmented
        label="Payout mode"
        value={payoutMode}
        onChange={setPayoutMode}
        options={[
          { value: "maturity", label: "Maturity only" },
          { value: "periodic", label: "Periodic" },
          { value: "annuity", label: "Annuity" },
        ]}
      />

      {/* Payout details */}
      {usePayouts && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
            Payout details (year &amp; amount)
          </div>
          <div className="space-y-2">
            {payouts.map((p, i) => (
              <div key={i} className="flex items-end gap-2">
                <label className="block">
                  <span className="text-[10px] text-muted-foreground block mb-0.5">Payout {i + 1} — year</span>
                  <input
                    type="number" value={p.year} step={1} min={1}
                    onChange={(e) => setPayout(i, { year: clampNum(e.target.value) })}
                    className="input-base text-sm w-24"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground block mb-0.5">Amount (₹)</span>
                  <input
                    type="number" value={p.amount} step={5000} min={0}
                    onChange={(e) => setPayout(i, { amount: clampNum(e.target.value) })}
                    className="input-base text-sm w-36"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removePayout(i)}
                  className="text-rose-500 hover:text-rose-700 text-lg leading-none pb-1.5 print:hidden"
                  aria-label={`Remove payout ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addPayout} className="btn-ghost text-xs print:hidden">+ Add payout</button>
          </div>
          {payoutMode === "annuity" && (
            <p className="text-[10px] text-muted-foreground mt-1">
              For an annuity, add one row per annuity year (year + amount received).
            </p>
          )}
        </div>
      )}

      {/* Additional options */}
      <div className="grid md:grid-cols-3 gap-3 items-end rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent">
        <Toggle checked={showMfCompare} onChange={setShowMfCompare} label="Add mutual fund comparison" />
        <Toggle checked={showMfMaturity} onChange={setShowMfMaturity} label="Show MF maturity value" />
        <NumberField label="Expected MF return (%)" value={expectedReturnPct} setValue={setExpectedReturnPct} step={0.5} />
      </div>

      {policyName && <div className="text-sm font-medium">{policyName}</div>}

      {/* Insurance summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total premiums" value={inr(result.totalPremiums)} />
        <Stat label="Total benefit" value={inr(result.totalBenefit)} />
        <Stat label="Net gain" value={inr(result.netGain)} />
        <Stat
          label="Policy IRR"
          value={result.irrPct == null ? "—" : `${result.irrPct.toFixed(2)}%`}
          tone={irrTone as any}
        />
      </div>

      {result.irrPct != null && (
        <Insight tone={irrTone as any}>
          This policy returns <strong>{result.irrPct.toFixed(2)}% IRR</strong>
          {result.irrPct < expectedReturnPct
            ? ` — below the ${fmtPct(expectedReturnPct)} a mutual fund is assumed to deliver, and likely below long-term inflation.`
            : ` — competitive with the ${fmtPct(expectedReturnPct)} assumed for mutual funds.`}
        </Insight>
      )}

      {/* MF comparison */}
      {showMfCompare && (
        <Section n={1} title={`Mutual fund comparison (same premiums @ ${fmtPct(expectedReturnPct)})`}>
          <Table
            head={["Metric", "Insurance", "Mutual fund"]}
            rows={[
              ["Maturity / value", inr(result.totalBenefit), inr(result.mfMaturity)],
              ["You invest", inr(result.totalPremiums), inr(result.totalPremiums)],
            ]}
            highlightCol={2}
          />
          <Insight>
            The same premiums in a mutual fund could grow to <strong>{inr(result.mfMaturity)}</strong>
            {result.mfWealthAdvantage > 0 && (
              <> — about <strong>{inr(result.mfWealthAdvantage)}</strong> more wealth
                {result.mfAdvantagePct != null && ` (${Math.round(result.mfAdvantagePct)}% higher)`}.</>
            )}
          </Insight>
          <Insight tone="cyan">
            To reach the same {inr(result.totalBenefit)} from a mutual fund, you'd only need to invest about{" "}
            <strong>{inr(result.mfContributionToMatch)}/year</strong> — far less than the {inr(annualPremium)} premium.
          </Insight>
        </Section>
      )}

      {/* MF maturity value (standalone) */}
      {showMfMaturity && !showMfCompare && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label={`MF maturity value @ ${fmtPct(expectedReturnPct)}`} value={inr(result.mfMaturity)} tone="emerald" />
        </div>
      )}
    </div>
  );
}
