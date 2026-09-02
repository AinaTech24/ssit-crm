"use client";

/**
 * Review of Investments — a periodic side-by-side performance review of a
 * client's existing mutual-fund (and other) holdings. The MFD adds a row per
 * scheme (asset class · category · scheme) and records its trailing returns
 * across the periods they care about; period columns can be shown/hidden, and
 * an unweighted average row summarises the set.
 *
 * Pure client-side, no data feed: the CRM has a scheme catalogue but no
 * trailing-return source, so performance figures are entered by the reviewer
 * (from their research / factsheet). Prints on the branded calculator
 * letterhead for handing to the client.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import { SchemeAutocomplete, type SchemePick } from "../mf/SchemeAutocomplete";

/** Map an MFAPI scheme category to one of our asset-class buckets. */
function deriveAssetClass(cat?: string | null): string | null {
  const c = (cat ?? "").toLowerCase();
  if (c.includes("equity")) return "Equity";
  if (c.includes("debt")) return "Debt";
  if (c.includes("hybrid")) return "Hybrid";
  if (c.includes("gold") || c.includes("silver") || c.includes("commodit")) return "Commodity";
  if (c.includes("solution")) return "Solution Oriented";
  return null;
}

const PERIODS = [
  { key: "m1", label: "1 mth" },
  { key: "m3", label: "3 mth" },
  { key: "m6", label: "6 mth" },
  { key: "y1", label: "1 Year" },
  { key: "y3", label: "3 Year" },
  { key: "y5", label: "5 Year" },
  { key: "y10", label: "10 Year" },
  { key: "si", label: "Since Inception" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const DEFAULT_VISIBLE: Record<PeriodKey, boolean> = {
  m1: false, m3: false, m6: true, y1: true, y3: true, y5: true, y10: true, si: false,
};

const ASSET_CLASSES = ["Equity", "Debt", "Hybrid", "Commodity", "Solution Oriented", "Other", "Custom"];
const CATEGORIES = [
  "Large Cap", "Large & Mid Cap", "Mid Cap", "Small Cap", "Flexi Cap", "Multi Cap",
  "ELSS (Tax Saver)", "Focused", "Value / Contra", "Sectoral / Thematic", "Index / ETF",
  "Aggressive Hybrid", "Balanced Advantage", "Conservative Hybrid", "Multi Asset", "Arbitrage",
  "Liquid", "Ultra Short Duration", "Short Duration", "Corporate Bond", "Gilt", "Dynamic Bond",
  "Gold / Silver", "Other", "Custom",
];

type Perf = Partial<Record<PeriodKey, number | "">>;
type Row = { id: number; assetClass: string; category: string; scheme: string; perf: Perf };

let nextId = 1;
const blankRow = (): Row => ({ id: nextId++, assetClass: "Equity", category: "Large Cap", scheme: "", perf: {} });

export function ReviewOfInvestments() {
  const [clientName, setClientName] = useState("");
  const [visible, setVisible] = useState<Record<PeriodKey, boolean>>(DEFAULT_VISIBLE);
  const [rows, setRows] = useState<Row[]>(() => [blankRow(), blankRow(), blankRow()]);

  const shownPeriods = PERIODS.filter((p) => visible[p.key]);

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function updatePerf(id: number, key: PeriodKey, raw: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, perf: { ...r.perf, [key]: raw === "" ? "" : signedNum(raw) } } : r
      )
    );
  }
  function addRow() { setRows((prev) => [...prev, blankRow()]); }
  function removeRow(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  /** A scheme was picked from the MFAPI catalog — set name + asset class +
   *  category immediately, then fetch live trailing returns and fill the cells. */
  async function applyScheme(id: number, pick: SchemePick) {
    const ac = deriveAssetClass(pick.category);
    updateRow(id, { scheme: pick.schemeName, ...(ac ? { assetClass: ac } : {}), ...(pick.category ? { category: pick.category } : {}) });
    try {
      const res = await fetch(`/api/mf/schemes/${encodeURIComponent(pick.schemeCode)}/returns`);
      if (!res.ok) return;
      const j = await res.json();
      const ret = j?.returns ?? {};
      const r1 = (v: unknown) => (typeof v === "number" ? Math.round(v * 10) / 10 : "");
      const ac2 = deriveAssetClass(j?.category ?? pick.category);
      setRows((prev) => prev.map((row) => row.id === id ? {
        ...row,
        ...(j?.category ? { category: j.category } : {}),
        ...(ac2 ? { assetClass: ac2 } : {}),
        perf: { m1: r1(ret.m1), m3: r1(ret.m3), m6: r1(ret.m6), y1: r1(ret.y1), y3: r1(ret.y3), y5: r1(ret.y5), si: r1(ret.si) },
      } : row));
    } catch { /* upstream unreachable — keep manual entry */ }
  }

  // Unweighted average per visible period (across rows that have a value).
  const averages: Record<string, number | null> = {};
  for (const p of shownPeriods) {
    const vals = rows.map((r) => r.perf[p.key]).filter((v): v is number => typeof v === "number");
    averages[p.key] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Review of Investments</h2>
        <p className="text-xs text-muted-foreground">
          A periodic side-by-side performance review of a client&apos;s existing
          mutual-fund holdings. Add a row per scheme and record its trailing
          returns; show or hide the periods you want on the report.
        </p>
      </div>

      {/* Period visibility toggles */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 p-3 bg-secondary/20 print:hidden">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Show periods:</span>
        {PERIODS.map((p) => (
          <label key={p.key} className="flex items-center gap-1.5 cursor-pointer select-none text-xs">
            <input
              type="checkbox"
              checked={visible[p.key]}
              onChange={(e) => setVisible((prev) => ({ ...prev, [p.key]: e.target.checked }))}
              className="size-3.5 rounded border-border accent-primary"
            />
            {p.label}
          </label>
        ))}
      </div>

      {clientName && (
        <div className="text-sm font-medium">
          Investment review for <span className="text-primary">{clientName}</span>
        </div>
      )}

      {/* Review table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[640px]">
          <thead>
            <tr className="text-left">
              <Th>Asset class</Th>
              <Th>Category</Th>
              <Th>Scheme</Th>
              {shownPeriods.map((p) => (
                <Th key={p.key} center>{p.label}</Th>
              ))}
              <Th center>Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="p-1.5 align-top">
                  <SelectOrCustom value={r.assetClass} options={ASSET_CLASSES} onChange={(v) => updateRow(r.id, { assetClass: v })} />
                </td>
                <td className="p-1.5 align-top">
                  <SelectOrCustom value={r.category} options={CATEGORIES} onChange={(v) => updateRow(r.id, { category: v })} />
                </td>
                <td className="p-1.5 align-top min-w-[240px]">
                  <SchemeAutocomplete
                    size="sm"
                    defaultValue={r.scheme}
                    placeholder="Search scheme (live from MFAPI)…"
                    onSelect={(s) => applyScheme(r.id, s)}
                    onQueryChange={(q) => updateRow(r.id, { scheme: q })}
                  />
                </td>
                {shownPeriods.map((p) => (
                  <td key={p.key} className="p-1.5 align-top">
                    <input
                      type="number"
                      step={0.1}
                      value={r.perf[p.key] ?? ""}
                      onChange={(e) => updatePerf(r.id, p.key, e.target.value)}
                      placeholder="%"
                      className="input-base text-sm w-20 text-right tabular-nums"
                    />
                  </td>
                ))}
                <td className="p-1.5 align-top text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(r.id)}
                    className="text-rose-500 hover:text-rose-700 print:hidden"
                    aria-label="Remove row"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {/* Average row */}
            {rows.length > 1 && (
              <tr className="bg-secondary/30 font-medium">
                <td className="p-1.5" colSpan={3}>Average (unweighted)</td>
                {shownPeriods.map((p) => (
                  <td key={p.key} className="p-1.5 text-right tabular-nums">
                    {averages[p.key] == null ? "—" : `${averages[p.key]!.toFixed(2)}%`}
                  </td>
                ))}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={addRow} className="btn-secondary text-xs print:hidden">+ Add more</button>

      <p className="text-[11px] text-muted-foreground">
        Pick a scheme to <strong>auto-fill live trailing returns from MFAPI</strong> (point-to-point; periods ≥ 1 year are annualised),
        or type any name and enter values manually. *Mutual fund investments are subject to market risk; read all scheme-related
        documents carefully. Past performance may or may not be sustained.
      </p>
    </div>
  );
}

/* ───────── small helpers ───────── */

function signedNum(raw: string): number {
  // Returns may be negative — keep the sign (clampNum would floor at 0).
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <th className={`py-1.5 px-2 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border ${center ? "text-center" : ""}`}>
      {children}
    </th>
  );
}

function SelectOrCustom({
  value, options, onChange,
}: { value: string; options: string[]; onChange: (v: string) => void }) {
  // "Custom" in the list switches to a free-text input.
  const isPreset = options.includes(value) && value !== "Custom";
  const [custom, setCustom] = useState(!isPreset);

  if (custom) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={value === "Custom" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Custom…"
          className="input-base text-sm w-28"
        />
        <button type="button" onClick={() => { setCustom(false); onChange(options[0]); }} className="text-[10px] text-muted-foreground hover:text-foreground print:hidden" title="Back to list">↩</button>
      </div>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === "Custom") { setCustom(true); onChange(""); }
        else onChange(e.target.value);
      }}
      className="input-base text-sm w-32"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
