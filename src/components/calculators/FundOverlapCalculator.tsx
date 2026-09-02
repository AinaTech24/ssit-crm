"use client";

/**
 * Fund Overlap Calculator - quick diagnostic for over-diversified portfolios.
 * The RM can enter category, value and overlap estimates from factsheets or a
 * research tool, then show how many funds the portfolio effectively behaves like.
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { BarsChart, inrShort } from "./charts";
import { clampNum, Field, inr, Insight, NumberField, Stat, Table } from "./ui";
import { ClientNameField } from "./ClientNameField";
import { SchemeAutocomplete, type SchemePick } from "../mf/SchemeAutocomplete";

type Row = {
  id: number;
  fundName: string;
  category: string;
  value: number;
  overlapPct: number;
  underperformancePct: number;
};

const CATEGORIES = [
  "Large Cap",
  "Flexi Cap",
  "Large & Mid Cap",
  "Mid Cap",
  "Small Cap",
  "ELSS",
  "Index",
  "Hybrid",
  "Debt",
  "Gold",
  "Other",
];

/**
 * Map a raw MFAPI scheme_category (e.g. "Equity Scheme - Large & Mid Cap Fund")
 * onto one of this calculator's short category buckets. Most-specific patterns
 * first so "Large & Mid Cap" wins over "Large Cap" / "Mid Cap".
 */
const CATEGORY_MATCHERS: Array<[RegExp, string]> = [
  [/large\s*&\s*mid|large\s*and\s*mid/i, "Large & Mid Cap"],
  [/flexi\s*cap|multi\s*cap/i, "Flexi Cap"],
  [/large\s*cap/i, "Large Cap"],
  [/mid\s*cap/i, "Mid Cap"],
  [/small\s*cap/i, "Small Cap"],
  [/elss|tax\s*saver/i, "ELSS"],
  [/index|nifty|sensex|etf/i, "Index"],
  [/hybrid|balanced|asset\s*alloc|arbitrage/i, "Hybrid"],
  [/debt|bond|gilt|liquid|duration|credit|money\s*market|overnight/i, "Debt"],
  [/gold|silver|commodit/i, "Gold"],
];
function mapSchemeCategory(raw: string | null): string | null {
  if (!raw) return null;
  for (const [re, cat] of CATEGORY_MATCHERS) if (re.test(raw)) return cat;
  return null;
}

let nextId = 1;
const mk = (fundName: string, category: string, value: number, overlapPct: number, underperformancePct = 0): Row => ({
  id: nextId++,
  fundName,
  category,
  value,
  overlapPct,
  underperformancePct,
});

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function FundOverlapCalculator() {
  const [clientName, setClientName] = useState("");
  const [reviewThreshold, setReviewThreshold] = useState(55);
  const [rows, setRows] = useState<Row[]>(() => [
    mk("Large Cap Fund A", "Large Cap", 900000, 68, 1.2),
    mk("Large Cap Fund B", "Large Cap", 650000, 72, 0.8),
    mk("Flexi Cap Fund", "Flexi Cap", 850000, 46, 0),
    mk("Index Fund", "Index", 600000, 58, 0),
    mk("Mid Cap Fund", "Mid Cap", 500000, 24, 0),
  ]);

  const result = useMemo(() => {
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const count = rows.length;
    const weightedOverlap = total <= 0 ? 0 : rows.reduce((sum, r) => sum + r.value * clamp(r.overlapPct, 0, 100), 0) / total;
    const categoryMap = new Map<string, Row[]>();
    for (const r of rows) {
      categoryMap.set(r.category, [...(categoryMap.get(r.category) ?? []), r]);
    }
    const duplicateFunds = [...categoryMap.values()].reduce((sum, group) => sum + Math.max(0, group.length - 1), 0);
    const duplicateValue = [...categoryMap.values()].reduce((sum, group) => {
      if (group.length <= 1) return sum;
      const sorted = [...group].sort((a, b) => b.value - a.value);
      return sum + sorted.slice(1).reduce((s, r) => s + r.value, 0);
    }, 0);
    const overlapCompression = (weightedOverlap / 100) * Math.max(0, count - 1);
    const duplicateCompression = duplicateFunds * 0.35;
    const effectiveFundCount = clamp(count - overlapCompression - duplicateCompression, 1, count);
    const overlapRisk = Math.round(clamp(weightedOverlap * 0.55 + duplicateFunds * 8 + count * 1.2, 0, 100));
    const candidates = rows
      .filter((r) => r.overlapPct >= reviewThreshold || r.underperformancePct >= 1 || (categoryMap.get(r.category)?.length ?? 0) > 1)
      .sort((a, b) => b.overlapPct + b.underperformancePct * 8 - (a.overlapPct + a.underperformancePct * 8));
    const possibleTrim = candidates.reduce((sum, r) => sum + r.value, 0);
    const categoryRows = [...categoryMap.entries()]
      .map(([category, group]) => ({
        category,
        funds: group.length,
        value: group.reduce((sum, r) => sum + r.value, 0),
        avgOverlap: group.reduce((sum, r) => sum + r.overlapPct, 0) / group.length,
      }))
      .sort((a, b) => b.value - a.value);

    return {
      total,
      count,
      weightedOverlap,
      duplicateFunds,
      duplicateValue,
      effectiveFundCount,
      overlapRisk,
      candidates,
      possibleTrim,
      categoryRows,
    };
  }, [reviewThreshold, rows]);

  function update(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // A real scheme was picked from the MFAPI catalog — set the fund name and,
  // when we recognise it, auto-map the category bucket.
  function applyScheme(id: number, s: SchemePick) {
    const cat = mapSchemeCategory(s.category);
    update(id, { fundName: s.schemeName, ...(cat ? { category: cat } : {}) });
  }

  function addRow() {
    setRows((prev) => [...prev, mk("New fund", "Flexi Cap", 0, 0)]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Fund Overlap Calculator</h2>
        <p className="text-xs text-muted-foreground">
          Show whether many funds are truly diversifying the portfolio or simply repeating the same exposure.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <NumberField label="Review threshold overlap (%)" value={reviewThreshold} setValue={setReviewThreshold} step={1} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[880px]">
          <thead>
            <tr className="text-left">
              {["Fund", "Category", "Value", "Overlap", "Underperformance", "Signal", ""].map((h, i) => (
                <th key={h} className={`py-1.5 px-2 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border ${i >= 2 && i <= 5 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const duplicate = rows.some((x) => x.id !== r.id && x.category === r.category);
              const risky = r.overlapPct >= reviewThreshold || r.underperformancePct >= 1 || duplicate;
              return (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="p-1.5 align-top min-w-[240px]">
                    <SchemeAutocomplete
                      size="sm"
                      defaultValue={r.fundName}
                      placeholder="Search fund (live)…"
                      onSelect={(s) => applyScheme(r.id, s)}
                      onQueryChange={(q) => update(r.id, { fundName: q })}
                    />
                  </td>
                  <td className="p-1.5">
                    <select value={r.category} onChange={(e) => update(r.id, { category: e.target.value })} className="input-base text-sm w-36">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <input type="number" value={r.value} step={50000} min={0} onChange={(e) => update(r.id, { value: clampNum(e.target.value) })} className="input-base text-sm w-32 text-right" />
                  </td>
                  <td className="p-1.5">
                    <input type="number" value={r.overlapPct} step={1} min={0} max={100} onChange={(e) => update(r.id, { overlapPct: clamp(clampNum(e.target.value), 0, 100) })} className="input-base text-sm w-24 text-right" />
                  </td>
                  <td className="p-1.5">
                    <input type="number" value={r.underperformancePct} step={0.1} min={0} onChange={(e) => update(r.id, { underperformancePct: clampNum(e.target.value) })} className="input-base text-sm w-24 text-right" />
                  </td>
                  <td className={`p-1.5 text-right font-semibold ${risky ? "text-amber-700" : "text-emerald-700"}`}>
                    {risky ? "Review" : "Keep"}
                  </td>
                  <td className="p-1.5 text-center">
                    <button type="button" onClick={() => removeRow(r.id)} className="text-rose-500 hover:text-rose-700 print:hidden" aria-label="Remove fund">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={addRow} className="btn-ghost text-xs print:hidden">+ Add fund</button>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Funds entered" value={`${result.count}`} />
        <Stat label="Effective funds" value={result.effectiveFundCount.toFixed(1)} tone="cyan" />
        <Stat label="Weighted overlap" value={pct(result.weightedOverlap)} tone={result.weightedOverlap >= 55 ? "rose" : result.weightedOverlap >= 35 ? "amber" : "emerald"} />
        <Stat label="Overlap risk" value={`${result.overlapRisk}/100`} tone={result.overlapRisk >= 70 ? "rose" : result.overlapRisk >= 45 ? "amber" : "emerald"} />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={result.categoryRows.map((r) => ({
          label: r.category,
          value: r.value,
          display: `${r.funds} fund${r.funds === 1 ? "" : "s"}`,
          caption: pct(r.avgOverlap),
          color: r.funds > 1 ? "#f59e0b" : "#10b981",
        }))}
      />

      <Table
        head={["Category", "Funds", "Value", "Avg overlap"]}
        rows={result.categoryRows.map((r) => [r.category, r.funds, inr(r.value), pct(r.avgOverlap)])}
      />

      <Insight tone={result.overlapRisk >= 70 ? "rose" : result.overlapRisk >= 45 ? "amber" : "emerald"}>
        {clientName || "This portfolio"} has <strong>{result.count}</strong> funds, but behaves like roughly{" "}
        <strong>{result.effectiveFundCount.toFixed(1)}</strong> differentiated funds. Duplicate-category value is{" "}
        <strong>{inr(result.duplicateValue)}</strong>.
      </Insight>

      <Insight tone="cyan">
        Consolidation candidates: <strong>{result.candidates.length}</strong> funds, representing{" "}
        <strong>{inr(result.possibleTrim)}</strong>. Start with high-overlap funds in duplicate categories before switching good performers.
      </Insight>
    </div>
  );
}
