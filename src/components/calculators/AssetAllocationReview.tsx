"use client";

/**
 * Asset Allocation Review — Existing vs Suggested portfolio report.
 *
 * Models the advisor "Asset Allocation Report" worksheet: 12 product sleeves
 * with amount + assumed return, projected to two horizons (5y & 10y), the SIP
 * sleeve grown monthly (annuity-due). Adds an Existing-vs-Suggested uplift, a
 * risk-bucket asset-mix rollup, blended return and a growth chart.
 *
 * Math: @/lib/calculators/asset-allocation-review.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { inr, Section, Stat, Table, Insight } from "./ui";
import { LinesChart, BarsChart, inrShort } from "./charts";
import {
  ALLOC_CLASSES,
  computeAssetAllocationReview,
  EXISTING_DEFAULTS,
  SUGGESTED_DEFAULTS,
  type AllocRow,
  type PortfolioResult,
} from "@/lib/calculators/asset-allocation-review";

export function AssetAllocationReview() {
  const [clientName, setClientName] = useState("");
  const [horizonA, setHorizonA] = useState(5);
  const [horizonB, setHorizonB] = useState(10);
  const [existing, setExisting] = useState<AllocRow[]>(EXISTING_DEFAULTS.map((r) => ({ ...r })));
  const [suggested, setSuggested] = useState<AllocRow[]>(SUGGESTED_DEFAULTS.map((r) => ({ ...r })));

  const result = useMemo(
    () => computeAssetAllocationReview(existing, suggested, { horizonA, horizonB }),
    [existing, suggested, horizonA, horizonB]
  );

  const setRow = (which: "existing" | "suggested", idx: number, patch: Partial<AllocRow>) => {
    const setter = which === "existing" ? setExisting : setSuggested;
    const arr = which === "existing" ? existing : suggested;
    setter(arr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const yA = horizonA, yB = horizonB;
  const e = result.existing, s = result.suggested;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Asset Allocation Review — Existing vs Suggested</h2>
        <p className="text-xs text-muted-foreground">
          Map the client&apos;s current portfolio across asset sleeves, propose a rebalanced mix, and show the projected
          wealth at two horizons. The SIP sleeve is grown monthly; lumpsum sleeves compound annually.
        </p>
      </div>

      {/* Top inputs (captured as PDF assumptions) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Num label="Horizon A (years)" value={horizonA} setValue={setHorizonA} step={1} />
        <Num label="Horizon B (years)" value={horizonB} setValue={setHorizonB} step={1} />
      </div>

      {/* Editable grid — on-screen only */}
      <div className="print:hidden border border-border rounded-lg overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs min-w-[640px]">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Product sleeve</th>
              <th className="px-3 py-2 font-medium text-right" colSpan={2}>Existing</th>
              <th className="px-3 py-2 font-medium text-right" colSpan={2}>Suggested</th>
            </tr>
            <tr className="text-left text-[10px]">
              <th className="px-3 py-1"></th>
              <th className="px-3 py-1 text-right">Amount ₹</th>
              <th className="px-3 py-1 text-right">Return %</th>
              <th className="px-3 py-1 text-right border-l border-border">Amount ₹</th>
              <th className="px-3 py-1 text-right">Return %</th>
            </tr>
          </thead>
          <tbody>
            {ALLOC_CLASSES.map((c, i) => (
              <tr key={c.key} className="border-t border-border/50">
                <td className="px-3 py-1.5 font-medium whitespace-nowrap">
                  {c.label}
                  {c.kind === "monthly" && <span className="ml-1 text-[9px] text-muted-foreground">/mo</span>}
                </td>
                <td className="px-2 py-1"><GridNum value={existing[i].amount} onChange={(v) => setRow("existing", i, { amount: v })} step={50000} /></td>
                <td className="px-2 py-1"><GridNum value={existing[i].returnPct} onChange={(v) => setRow("existing", i, { returnPct: v })} step={0.5} /></td>
                <td className="px-2 py-1 border-l border-border"><GridNum value={suggested[i].amount} onChange={(v) => setRow("suggested", i, { amount: v })} step={50000} /></td>
                <td className="px-2 py-1"><GridNum value={suggested[i].returnPct} onChange={(v) => setRow("suggested", i, { returnPct: v })} step={0.5} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-secondary/30 font-semibold">
            <tr className="border-t border-border">
              <td className="px-3 py-2">Gross corpus (excl. SIP)</td>
              <td className="px-3 py-2 text-right tabular-nums">{inr(e.lumpsumCorpus)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{e.blendedReturnPct.toFixed(2)}%</td>
              <td className="px-3 py-2 text-right tabular-nums border-l border-border">{inr(s.lumpsumCorpus)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.blendedReturnPct.toFixed(2)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ===== Results (captured for PDF) ===== */}

      <Section n={1} title="Existing vs Suggested — the uplift">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label={`Existing value (${yA}y)`} value={inr(e.valueA)} />
          <Stat label={`Suggested value (${yA}y)`} value={inr(s.valueA)} tone="cyan" />
          <Stat label={`Extra in ${yA} years`} value={inr(result.upliftA)} tone={result.upliftA >= 0 ? "emerald" : "rose"} />
          <Stat label={`Existing value (${yB}y)`} value={inr(e.valueB)} />
          <Stat label={`Suggested value (${yB}y)`} value={inr(s.valueB)} tone="cyan" />
          <Stat label={`Extra in ${yB} years`} value={inr(result.upliftB)} tone={result.upliftB >= 0 ? "emerald" : "rose"} />
        </div>
        <Insight tone={result.upliftB >= 0 ? "emerald" : "amber"}>
          On the same corpus of {inr(e.lumpsumCorpus)} (plus {inr(e.sipMonthly)}/mo SIP), the suggested allocation lifts the
          blended return from {e.blendedReturnPct.toFixed(2)}% to {s.blendedReturnPct.toFixed(2)}% and projects{" "}
          <strong>{inr(Math.abs(result.upliftB))} {result.upliftB >= 0 ? "more" : "less"}</strong> wealth in {yB} years.
        </Insight>
      </Section>

      <Section n={2} title="Asset mix by risk bucket">
        <Table
          head={["Bucket", "Existing ₹", "Existing %", "Suggested ₹", "Suggested %"]}
          rows={bucketRows(e, s)}
        />
        <div className="grid md:grid-cols-2 gap-4 mt-1">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Existing mix</div>
            <BarsChart bars={bucketBars(e)} fmtV={(v) => `${v.toFixed(0)}%`} accent="#94a3b8" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Suggested mix</div>
            <BarsChart bars={bucketBars(s)} fmtV={(v) => `${v.toFixed(0)}%`} accent="#B71A20" />
          </div>
        </div>
      </Section>

      <Section n={3} title={`Projected growth (next ${Math.max(yA, yB)} years)`}>
        <LinesChart
          xLabels={e.growth.map((g) => g.year)}
          lines={[
            { label: "Existing", color: "#94a3b8", values: e.growth.map((g) => g.value) },
            { label: "Suggested", color: "#B71A20", values: s.growth.map((g) => g.value) },
          ]}
          fmtY={inrShort}
          ariaLabel="Projected portfolio value: existing vs suggested"
        />
      </Section>

      <Section n={4} title="Existing portfolio — sleeve detail">
        <PortfolioTable p={e} yA={yA} yB={yB} />
      </Section>

      <Section n={5} title="Suggested portfolio — sleeve detail">
        <PortfolioTable p={s} yA={yA} yB={yB} />
      </Section>

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Each sleeve is assumed to grow at its stated annual return; the SIP sleeve compounds monthly
        (begin-of-month). The gross corpus and allocation % exclude the monthly SIP. Returns are not guaranteed and vary
        with markets. Not investment advice — mutual fund investments are subject to market risks.
      </p>
    </div>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

function bucketRows(e: PortfolioResult, s: PortfolioResult): (string | number)[][] {
  const keys = Array.from(new Set([...e.buckets.map((b) => b.bucket), ...s.buckets.map((b) => b.bucket)]));
  return keys.map((k) => {
    const eb = e.buckets.find((b) => b.bucket === k);
    const sb = s.buckets.find((b) => b.bucket === k);
    return [
      k,
      inr(eb?.amount ?? 0),
      `${(eb?.pct ?? 0).toFixed(1)}%`,
      inr(sb?.amount ?? 0),
      `${(sb?.pct ?? 0).toFixed(1)}%`,
    ];
  });
}

function bucketBars(p: PortfolioResult) {
  return p.buckets.map((b) => ({ label: b.bucket, value: b.pct, display: `${b.pct.toFixed(0)}%`, caption: inrShort(b.amount) }));
}

function PortfolioTable({ p, yA, yB }: { p: PortfolioResult; yA: number; yB: number }) {
  const rows: (string | number)[][] = p.sleeves
    .filter((sl) => sl.amount > 0)
    .map((sl) => [
      sl.label + (sl.kind === "monthly" ? " (/mo)" : ""),
      inr(sl.amount),
      sl.kind === "monthly" ? "—" : `${sl.allocationPct.toFixed(1)}%`,
      `${sl.returnPct.toFixed(1)}%`,
      inr(sl.fvA),
      inr(sl.fvB),
    ]);
  rows.push([
    "Total",
    inr(p.lumpsumCorpus) + (p.sipMonthly > 0 ? ` + ${inr(p.sipMonthly)}/mo` : ""),
    "100%",
    `${p.blendedReturnPct.toFixed(2)}%`,
    inr(p.valueA),
    inr(p.valueB),
  ]);
  return <Table head={["Sleeve", "Amount", "% Alloc", "Return", `Value ${yA}y`, `Value ${yB}y`]} rows={rows} highlightLastRow />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Num({ label, value, setValue, step = 1 }: { label: string; value: number; setValue: (v: number) => void; step?: number }) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(ev) => {
          const n = ev.target.value === "" ? 0 : Number(ev.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function GridNum({ value, onChange, step }: { value: number; onChange: (v: number) => void; step: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={0}
      onChange={(e) => {
        const n = e.target.value === "" ? 0 : Number(e.target.value);
        onChange(Number.isFinite(n) && n >= 0 ? n : 0);
      }}
      className="input-base text-xs w-full text-right tabular-nums"
    />
  );
}
