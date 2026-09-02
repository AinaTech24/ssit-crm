"use client";

/**
 * Policy Surrender vs. Reinvest Analyzer.
 *
 * Compares keeping a traditional/endowment policy (pay remaining premiums →
 * collect maturity) against surrendering it now and investing the proceeds +
 * saved premiums elsewhere — side by side, at the end of the policy term.
 *
 * Math lives in @/lib/calculators/surrender-analysis (calibrated to the
 * reference case study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeSurrenderAnalysis, ALT_OPTIONS, type AltOption } from "@/lib/calculators/surrender-analysis";
import { SelectField } from "@/components/ui/SelectField";

export function SurrenderAnalyzer() {
  const [clientName, setClientName] = useState("");
  const [policyName, setPolicyName] = useState("");

  const [currentSurrenderValue, setCurrentSurrenderValue] = useState(480000);
  const [policyYearsLeft, setPolicyYearsLeft] = useState(15);
  const [premiumYearsLeft, setPremiumYearsLeft] = useState(10);
  const [annualPremium, setAnnualPremium] = useState(50000);
  const [expectedMaturityAmount, setExpectedMaturityAmount] = useState(1250000);
  const [altOption, setAltOption] = useState<AltOption>("equity_mf");
  const [altReturnPct, setAltReturnPct] = useState(12);

  const [includeAnnuity, setIncludeAnnuity] = useState(false);
  const [annuityStartYear, setAnnuityStartYear] = useState(1);
  const [annuityAnnualAmount, setAnnuityAnnualAmount] = useState(0);
  const [annuityYears, setAnnuityYears] = useState(0);

  const [includePeriodic, setIncludePeriodic] = useState(false);
  const [periodicEveryYears, setPeriodicEveryYears] = useState(5);
  const [periodicAmount, setPeriodicAmount] = useState(0);
  const [periodicTimes, setPeriodicTimes] = useState(0);

  const result = useMemo(
    () =>
      computeSurrenderAnalysis({
        policyName,
        currentSurrenderValue,
        policyYearsLeft,
        premiumYearsLeft,
        annualPremium,
        expectedMaturityAmount,
        altOption,
        altReturnPct,
        includeAnnuity,
        annuityStartYear,
        annuityAnnualAmount,
        annuityYears,
        includePeriodic,
        periodicEveryYears,
        periodicAmount,
        periodicTimes,
      }),
    [
      policyName, currentSurrenderValue, policyYearsLeft, premiumYearsLeft, annualPremium, expectedMaturityAmount,
      altOption, altReturnPct, includeAnnuity, annuityStartYear, annuityAnnualAmount, annuityYears,
      includePeriodic, periodicEveryYears, periodicAmount, periodicTimes,
    ]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Policy Surrender vs. Reinvest Analyzer</h2>
        <p className="text-xs text-muted-foreground">
          Keep paying a low-yield endowment policy, or surrender it and invest the proceeds — plus the premiums you&apos;d
          save — elsewhere? Compare both, side by side, at the end of the policy term.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Policy name (optional)">
          <input value={policyName} onChange={(e) => setPolicyName(e.target.value)} className="input-base text-sm w-full" placeholder="e.g. LIC Jeevan Anand" />
        </Field>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Current surrender value (₹)" value={currentSurrenderValue} setValue={setCurrentSurrenderValue} />
        <Num label="No. of policy years left" value={policyYearsLeft} setValue={setPolicyYearsLeft} step={1} />
        <Num label="No. of premium years left" value={premiumYearsLeft} setValue={setPremiumYearsLeft} step={1} />
        <Num label="Annual premium (₹)" value={annualPremium} setValue={setAnnualPremium} />
        <Num label="Expected maturity amount (₹)" value={expectedMaturityAmount} setValue={setExpectedMaturityAmount} />
        <Field label="Alternate investment">
          <SelectField
            value={altOption}
            onChange={(e) => {
              const opt = e.target.value as AltOption;
              setAltOption(opt);
              const meta = ALT_OPTIONS.find((o) => o.value === opt);
              if (meta) setAltReturnPct(meta.typicalReturn);
            }}
            className="w-full"
          >
            {ALT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </SelectField>
        </Field>
        <Num label="Assumed return on alternate (% p.a.)" value={altReturnPct} setValue={setAltReturnPct} step={0.5} />
      </div>

      {/* Optional future payouts (continue scenario) */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={includeAnnuity} onChange={(e) => setIncludeAnnuity(e.target.checked)} />
          Add future annuity payouts (if you continue)
        </label>
        {includeAnnuity && (
          <div className="grid grid-cols-3 gap-3 pl-6">
            <Num label="Starts in year" value={annuityStartYear} setValue={setAnnuityStartYear} step={1} />
            <Num label="Annual payout (₹)" value={annuityAnnualAmount} setValue={setAnnuityAnnualAmount} />
            <Num label="For how many years" value={annuityYears} setValue={setAnnuityYears} step={1} />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={includePeriodic} onChange={(e) => setIncludePeriodic(e.target.checked)} />
          Add periodic money-back payouts (if you continue)
        </label>
        {includePeriodic && (
          <div className="grid grid-cols-3 gap-3 pl-6">
            <Num label="Every N years" value={periodicEveryYears} setValue={setPeriodicEveryYears} step={1} />
            <Num label="Payout amount (₹)" value={periodicAmount} setValue={setPeriodicAmount} />
            <Num label="Number of payouts" value={periodicTimes} setValue={setPeriodicTimes} step={1} />
          </div>
        )}
      </div>

      {/* Side-by-side comparison */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Continue */}
        <section className="border border-amber-200 bg-amber-50/40 rounded-lg p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-700">If you CONTINUE the policy</div>
          <Row k="Current surrender value (kept in)" v={inr(currentSurrenderValue)} />
          <Row k="Future premiums to pay" v={inr(result.futurePremiumsPaid)} />
          {result.totalPayouts > 0 && <Row k="Money-back / annuity payouts" v={inr(result.totalPayouts)} />}
          <Row k="Expected payout + maturity" v={inr(result.expectedPayoutAndMaturity)} strong />
          <Row k="Incremental return" v={inr(result.incrementalReturn)} />
          <Row k="Effective policy IRR" v={result.policyIrrPct == null ? "—" : `${result.policyIrrPct.toFixed(2)}%`} strong />
        </section>

        {/* Surrender */}
        <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">If you SURRENDER &amp; invest</div>
          <Row k="Surrender value invested (lumpsum)" v={inr(currentSurrenderValue)} />
          <Row k="Premiums invested instead" v={inr(result.futurePremiumsPaid)} />
          <Row k={`Assumed return (${ALT_OPTIONS.find((o) => o.value === altOption)?.label})`} v={`${altReturnPct.toFixed(2)}%`} />
          <Row k="Expected value at the end" v={inr(result.expectedValueAtEnd)} strong />
          <Row k="Total return" v={inr(result.totalReturn)} strong />
        </section>
      </div>

      {/* Verdict */}
      <div
        className={`rounded-lg px-4 py-3 text-sm border ${
          result.surrenderIsBetter ? "border-emerald-200 bg-emerald-50/60 text-emerald-900" : "border-amber-200 bg-amber-50/60 text-amber-900"
        }`}
      >
        {result.surrenderIsBetter ? (
          <>
            On these numbers, <strong>surrendering &amp; investing</strong> could grow to <strong>{inr(result.expectedValueAtEnd)}</strong> —
            about <strong>{result.multipleVsMaturity.toFixed(1)}×</strong> the policy&apos;s {inr(result.expectedPayoutAndMaturity)}, a difference of{" "}
            <strong>{inr(result.advantageOfSurrender)}</strong>. The policy&apos;s own return is just{" "}
            <strong>{result.policyIrrPct?.toFixed(2)}%</strong> p.a.
          </>
        ) : (
          <>
            On these numbers, <strong>continuing the policy</strong> ({inr(result.expectedPayoutAndMaturity)}) is ahead of surrendering &amp;
            investing ({inr(result.expectedValueAtEnd)}) at the assumed {altReturnPct.toFixed(1)}% return.
          </>
        )}
      </div>

      {/* Protection caveat */}
      <div className="text-[11px] bg-blue-50/60 border border-blue-200 rounded-md px-3 py-2 text-blue-900">
        ⚠️ <strong>Before surrendering:</strong> a policy also provides <strong>life cover</strong> you would lose. Insurance is for
        protection; investments are for growth. If you surrender, consider a pure <strong>term plan</strong> for the cover, and check
        surrender charges, guarantees and tax before deciding.
      </div>

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only, on the assumptions you enter. Endowment maturity is typically guaranteed/bonus-based while market
        investments carry risk and are not guaranteed. This is not investment advice — review the policy document and consult a
        qualified advisor.
      </p>
    </div>
  );
}

/* ───────────────────────── bits ───────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Num({
  label,
  value,
  setValue,
  step = 1000,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => {
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? "font-semibold text-sm" : "font-medium"}>{v}</span>
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
