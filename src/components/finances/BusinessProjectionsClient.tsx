"use client";

/**
 * Business AUM & Earnings Projections — client UI for Network FP "8.4".
 *
 * Inputs are seeded from the firm's *actual* live book (current AUM, monthly SIP
 * book, blended commission rate) passed in from the server, so the projection
 * starts from reality instead of generic placeholders. The owner can still tune
 * every assumption; "Reset to my book" snaps back to the live figures.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, TrendingUp, Printer, RotateCcw, Sparkles } from "lucide-react";
import { formatINR } from "@/lib/utils";
import {
  projectBusiness,
  projectionSummary,
  DEFAULT_PROJECTION_INPUTS,
  type ProjectionInputs,
} from "@/lib/finance/projections";

export function BusinessProjectionsClient({
  seed,
  seeded,
}: {
  seed: ProjectionInputs;
  seeded: boolean;
}) {
  const [inp, setInp] = useState<ProjectionInputs>(seed);

  const rows = useMemo(() => projectBusiness(inp), [inp]);
  const summary = useMemo(() => projectionSummary(rows), [rows]);

  function num(k: keyof ProjectionInputs, v: string) {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    setInp((s) => ({ ...s, [k]: Number.isNaN(n) ? 0 : n }));
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/reports" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Reports
            </Link>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <TrendingUp className="size-6 text-brand-cyan" /> Business projections
          </h1>
        </div>
        <button onClick={() => window.print()} className="btn-ghost text-xs">
          <Printer className="size-3.5" /> Print
        </button>
      </div>

      {/* Assumptions */}
      <div className="card-surface p-5 print:hidden">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-sm">Assumptions</h2>
          {seeded ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <Sparkles className="size-3" /> Seeded from your live book
              </span>
              <button
                onClick={() => setInp(seed)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                title="Reset AUM, SIP book and commission rate to your current figures"
              >
                <RotateCcw className="size-3" /> Reset to my book
              </button>
            </div>
          ) : (
            <button
              onClick={() => setInp(DEFAULT_PROJECTION_INPUTS)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" /> Load example figures
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Existing AUM (₹)" value={inp.existingAum} onChange={(v) => num("existingAum", v)} />
          <Field label="Existing SIP book / mo (₹)" value={inp.existingSipBook} onChange={(v) => num("existingSipBook", v)} />
          <Field label="New SIP book / year (₹)" value={inp.newSipPerYear} onChange={(v) => num("newSipPerYear", v)} />
          <Field label="New lumpsum / year (₹)" value={inp.newLumpsumPerYear} onChange={(v) => num("newLumpsumPerYear", v)} />
          <Field label="Growth rate — new business (%)" value={inp.growthRatePct} onChange={(v) => num("growthRatePct", v)} />
          <Field label="Market growth rate (%)" value={inp.marketGrowthPct} onChange={(v) => num("marketGrowthPct", v)} />
          <Field label="Commission rate on AUM (%)" value={inp.commissionRatePct} onChange={(v) => num("commissionRatePct", v)} step="0.01" />
          <Field label="Years to project" value={inp.years} onChange={(v) => num("years", v)} />
        </div>
      </div>

      {/* Summary band */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label={`AUM in year ${inp.years}`} value={formatINR(summary.endAum)} tone="cyan" />
        <SummaryCard label={`Annual income — year ${inp.years}`} value={formatINR(summary.endEarnings)} tone="emerald" />
        <SummaryCard label={`SIP book — year ${inp.years}`} value={formatINR(summary.endSipBook)} tone="violet" />
        <SummaryCard label={`Cumulative income (${inp.years} yrs)`} value={formatINR(summary.cumulativeEarnings)} tone="emerald" />
      </div>

      {/* Projection table */}
      <div className="card-surface overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm">Year-by-year projection</div>
        <div className="table-scroll">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Year</th>
                <th className="text-right py-2 font-medium">New SIP</th>
                <th className="text-right py-2 font-medium">Cumulative SIP book</th>
                <th className="text-right py-2 font-medium">Lumpsum</th>
                <th className="text-right py-2 font-medium">Total AUM</th>
                <th className="text-right py-2 font-medium pr-4">Est. earnings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5 font-medium">{r.fyLabel}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(r.newSip)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(r.cumulativeSipBook)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(r.lumpsum)}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">{formatINR(r.totalAum)}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-emerald-700 pr-4">
                    {formatINR(r.estimatedEarnings)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Adapted from the Network FP &quot;8.4 Business Projections&quot;. Projections are illustrative
        estimates based on the assumptions above and do not guarantee future results.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base text-sm w-full tabular-nums"
      />
    </label>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "cyan" | "emerald" | "violet";
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "violet"
        ? "text-violet-700"
        : "text-brand-cyan-deep";
  return (
    <div className="card-surface glass-card p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
