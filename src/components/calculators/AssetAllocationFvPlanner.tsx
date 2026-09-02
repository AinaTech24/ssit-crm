"use client";

/**
 * Asset Allocation Future Value.
 *
 * Splits a lumpsum across asset classes (each with its own return & allocation),
 * grows each sleeve over the period, and reports the portfolio future value and
 * blended return — with an optional second allocation to compare.
 *
 * Math lives in @/lib/calculators/asset-allocation-fv (calibrated to the
 * reference case study to the rupee).
 */

import { useMemo, useState } from "react";
import { Plus, Trash } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import { SelectField } from "@/components/ui/SelectField";
import { computeAssetAllocationFv, ASSET_CLASSES, type AssetRow } from "@/lib/calculators/asset-allocation-fv";

const S1_DEFAULT: AssetRow[] = [
  { assetClass: "bonds", ratePct: 6, allocationPct: 20 },
  { assetClass: "debt", ratePct: 7, allocationPct: 30 },
  { assetClass: "equity", ratePct: 12, allocationPct: 40 },
  { assetClass: "gold", ratePct: 8, allocationPct: 10 },
];
const S2_DEFAULT: AssetRow[] = [
  { assetClass: "equity", ratePct: 12, allocationPct: 60 },
  { assetClass: "hybrid", ratePct: 9, allocationPct: 25 },
  { assetClass: "gold", ratePct: 8, allocationPct: 10 },
  { assetClass: "debt", ratePct: 7, allocationPct: 5 },
];

export function AssetAllocationFvPlanner() {
  const [clientName, setClientName] = useState("");
  const [initialInvestment, setInitialInvestment] = useState(1000000);
  const [years, setYears] = useState(15);
  const [s1, setS1] = useState<AssetRow[]>(S1_DEFAULT);
  const [s2enabled, setS2enabled] = useState(true);
  const [s2, setS2] = useState<AssetRow[]>(S2_DEFAULT);

  const result = useMemo(
    () => computeAssetAllocationFv({ initialInvestment, years, scenario1: s1, scenario2: s2enabled ? s2 : null }),
    [initialInvestment, years, s1, s2, s2enabled]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Asset Allocation — Future Value</h2>
        <p className="text-xs text-muted-foreground">
          Build a portfolio across asset classes and see its future value and blended return. Compare two allocation
          strategies to show the impact of a smarter mix.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Initial investment (₹)" value={initialInvestment} setValue={setInitialInvestment} />
        <Num label="Investment period (years)" value={years} setValue={setYears} step={1} />
      </div>

      <ScenarioEditor title="Scenario 1" rows={s1} setRows={setS1} result={result.scenario1} toneClass="text-primary" />

      <div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={s2enabled} onChange={(e) => setS2enabled(e.target.checked)} /> Compare with Scenario 2
        </label>
      </div>
      {s2enabled && result.scenario2 && (
        <ScenarioEditor title="Scenario 2" rows={s2} setRows={setS2} result={result.scenario2} toneClass="text-emerald-700" />
      )}

      {/* Comparison */}
      {s2enabled && result.scenario2 && (
        <div
          className={`rounded-lg px-4 py-3 text-sm border ${
            result.scenario2.futureValue >= result.scenario1.futureValue
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
              : "border-amber-200 bg-amber-50/60 text-amber-900"
          }`}
        >
          Scenario 1 grows {inr(initialInvestment)} to <strong>{inr(result.scenario1.futureValue)}</strong> (
          {result.scenario1.blendedReturnPct.toFixed(2)}%). Scenario 2 reaches <strong>{inr(result.scenario2.futureValue)}</strong> (
          {result.scenario2.blendedReturnPct.toFixed(2)}%) — a difference of{" "}
          <strong>{inr(Math.abs(result.scenario2.futureValue - result.scenario1.futureValue))}</strong> on the same investment &amp; tenure.
        </div>
      )}

      {/* Year-by-year */}
      {result.scenario1.schedule.length > 0 && (
        <details className="border border-slate-200 rounded-lg overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100">
            Year-wise projected portfolio value ({result.scenario1.schedule.length} years)
          </summary>
          <div className="max-h-72 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium text-right">Scenario 1</th>
                  {s2enabled && result.scenario2 && <th className="px-3 py-2 font-medium text-right">Scenario 2</th>}
                </tr>
              </thead>
              <tbody>
                {result.scenario1.schedule.map((row, i) => (
                  <tr key={row.year} className="border-b border-slate-100">
                    <td className="px-3 py-1.5">{row.year}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{inr(row.value)}</td>
                    {s2enabled && result.scenario2 && <td className="px-3 py-1.5 text-right">{inr(result.scenario2.schedule[i]?.value ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Each asset class is assumed to grow at its own annual return; the portfolio is the sum of the
        sleeves. Actual returns vary with market performance and are not guaranteed. Not investment advice.
      </p>
    </div>
  );
}

/* ───────────────────────── scenario editor ───────────────────────── */

function ScenarioEditor({
  title,
  rows,
  setRows,
  result,
  toneClass,
}: {
  title: string;
  rows: AssetRow[];
  setRows: (r: AssetRow[]) => void;
  result: { futureValue: number; blendedReturnPct: number; totalAllocationPct: number; totalInvested: number; gain: number };
  toneClass: string;
}) {
  const update = (i: number, patch: Partial<AssetRow>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const add = () => setRows([...rows, { assetClass: "equity", ratePct: 12, allocationPct: 0 }]);

  return (
    <section className="border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className={`text-[11px] uppercase tracking-wider font-semibold ${toneClass}`}>{title}</div>
        <div className={`text-[11px] font-semibold ${result.totalAllocationPct === 100 ? "text-emerald-600" : "text-rose-600"}`}>
          Total allocation {result.totalAllocationPct}%
        </div>
      </div>

      <div className="space-y-2">
        <div className="hidden md:grid grid-cols-[1fr_120px_120px_40px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-1">
          <div>Asset class</div>
          <div>Assumed rate %</div>
          <div>Allocation %</div>
          <div />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_120px_120px_40px] gap-2 items-center">
            <SelectField
              value={r.assetClass}
              onChange={(e) => {
                const meta = ASSET_CLASSES.find((a) => a.value === e.target.value);
                update(i, { assetClass: e.target.value, ratePct: meta ? meta.defaultReturn : r.ratePct });
              }}
              className="w-full"
              size="sm"
            >
              {ASSET_CLASSES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </SelectField>
            <input type="number" value={r.ratePct} step={0.5} min={0} onChange={(e) => update(i, { ratePct: Math.max(0, Number(e.target.value) || 0) })} className="input-base text-sm w-full" />
            <input type="number" value={r.allocationPct} step={5} min={0} onChange={(e) => update(i, { allocationPct: Math.max(0, Number(e.target.value) || 0) })} className="input-base text-sm w-full" />
            <button type="button" onClick={() => remove(i)} className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md justify-self-start" aria-label="Remove asset">
              <Trash className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={add} className="btn-ghost text-xs inline-flex items-center gap-1">
        <Plus className="size-3.5" /> Add asset
      </button>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        <Mini label="Invested" value={inr(result.totalInvested)} />
        <Mini label="Future value" value={inr(result.futureValue)} strong />
        <Mini label="Wealth gain" value={inr(result.gain)} />
        <Mini label="Blended return" value={`${result.blendedReturnPct.toFixed(2)}%`} strong />
      </div>
    </section>
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

function Num({ label, value, setValue, step = 1000 }: { label: string; value: number; setValue: (v: number) => void; step?: number }) {
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

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border border-slate-200 rounded-md p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className={`mt-0.5 ${strong ? "text-sm font-semibold" : "text-sm font-medium"}`}>{value}</div>
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
