"use client";

/**
 * Debt Fund (Hold vs Sell) Benefit Calculator.
 *
 * Shows whether a client should sell a debt fund now (short-term, slab-rate tax)
 * or hold it past the LTCG qualification window (indexed, lower-rate tax) — and
 * the effective post-tax return earned over just the remaining holding period.
 *
 * Math lives in @/lib/calculators/debt-fund-benefit (calibrated to the reference
 * case study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeDebtFundBenefit } from "@/lib/calculators/debt-fund-benefit";

export function DebtFundBenefitCalculator() {
  const [clientName, setClientName] = useState("");

  const [purchaseDate, setPurchaseDate] = useState("2020-07-20");
  const [investmentAmount, setInvestmentAmount] = useState(1000000);
  const [redemptionDate, setRedemptionDate] = useState("2022-11-14");
  const [currentMarketValue, setCurrentMarketValue] = useState(1200000);
  const [indexationRatePct, setIndexationRatePct] = useState(5);
  const [expectedReturnPct, setExpectedReturnPct] = useState(6);
  const [shortTermTaxPct, setShortTermTaxPct] = useState(30);
  const [longTermTaxPct, setLongTermTaxPct] = useState(20);
  const [ltcgYears, setLtcgYears] = useState(3);

  const r = useMemo(
    () =>
      computeDebtFundBenefit({
        purchaseDate, investmentAmount, redemptionDate, currentMarketValue,
        indexationRatePct, expectedReturnPct, shortTermTaxPct, longTermTaxPct, ltcgYears,
      }),
    [purchaseDate, investmentAmount, redemptionDate, currentMarketValue, indexationRatePct, expectedReturnPct, shortTermTaxPct, longTermTaxPct, ltcgYears]
  );

  const fmtDate = (iso: string) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Debt Fund — Hold vs Sell Benefit</h2>
        <p className="text-xs text-muted-foreground">
          Sell a debt fund now (short-term, taxed at slab) or hold it past the LTCG window (indexed, lower tax)? See the
          post-tax outcome of each — and the effective return earned just by waiting.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Purchase date">
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <Num label="Investment amount (₹)" value={investmentAmount} setValue={setInvestmentAmount} />
        <Field label="Redemption date (sell now)">
          <input type="date" value={redemptionDate} onChange={(e) => setRedemptionDate(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <Num label="Current market value (₹)" value={currentMarketValue} setValue={setCurrentMarketValue} />
        <Num label="Assumed indexation rate (%)" value={indexationRatePct} setValue={setIndexationRatePct} step={0.5} />
        <Num label="Expected return — remaining period (%)" value={expectedReturnPct} setValue={setExpectedReturnPct} step={0.5} />
        <Num label="Short-term tax rate (%)" value={shortTermTaxPct} setValue={setShortTermTaxPct} step={1} />
        <Num label="Long-term tax rate (%)" value={longTermTaxPct} setValue={setLongTermTaxPct} step={1} />
        <Num label="LTCG qualifies after (years)" value={ltcgYears} setValue={setLtcgYears} step={1} />
      </div>

      {!r.valid ? (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">Enter valid purchase and redemption dates.</div>
      ) : (
        <>
          {/* Two scenarios */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Sell today */}
            <section className="border border-amber-200 bg-amber-50/40 rounded-lg p-4 space-y-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-700">If redeemed today · {fmtDate(redemptionDate)}</div>
              <Row k="Investment amount" v={inr(investmentAmount)} />
              <Row k="Current market value" v={inr(currentMarketValue)} />
              <Row k="Taxable short-term gain" v={inr(r.shortTermGain)} />
              <Row k={`Tax payable @ ${shortTermTaxPct}%`} v={inr(r.shortTermTax)} />
              <Row k="Net in hand" v={inr(r.netIfSold)} strong />
              <Row k="Post-tax yield" v={`${r.postTaxYieldSold.toFixed(2)}%`} strong />
            </section>

            {/* Hold to LTCG */}
            <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-4 space-y-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
                If held to LTCG · {fmtDate(r.qualifyDate)} (after {r.remainingDays} days)
              </div>
              <Row k="Expected redemption amount" v={inr(r.expectedRedemptionAmount)} />
              <Row k={`Indexed cost (${r.indexYears}y @ ${indexationRatePct}%)`} v={inr(r.indexedCost)} />
              <Row k="Taxable long-term gain" v={inr(r.longTermGain)} />
              <Row k={`Tax payable @ ${longTermTaxPct}%`} v={inr(r.longTermTax)} />
              <Row k="Net in hand" v={inr(r.netIfHeld)} strong />
              <Row k="Post-tax yield" v={`${r.postTaxYieldHeld.toFixed(2)}%`} strong />
            </section>
          </div>

          {/* Headline */}
          <div className="rounded-lg px-4 py-3 text-sm border border-emerald-200 bg-emerald-50/60 text-emerald-900">
            By holding just <strong>{r.remainingDays} more days</strong> to qualify for LTCG, the client keeps an extra{" "}
            <strong>{inr(r.extraInHand)}</strong> (tax saved {inr(r.taxSaved)}) — an effective post-tax yield of{" "}
            <strong>{r.effectiveRemainingYield.toFixed(2)}%</strong> on the remaining period.
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Tax saved by holding" value={inr(r.taxSaved)} />
            <Stat label="Extra in hand" value={inr(r.extraInHand)} />
            <Stat label="Holding to qualify" value={`${(r.totalHoldingDays / 365).toFixed(2)} yrs`} />
            <Stat label="Remaining wait" value={`${r.remainingDays} days`} />
          </div>
        </>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Models the indexation regime; indexation on debt funds was withdrawn for units bought on/after
        1 Apr 2023 (gains taxed at slab regardless of period). Verify the applicable tax rules for the specific units. Not tax
        or investment advice.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-md p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
