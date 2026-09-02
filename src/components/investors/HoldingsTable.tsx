"use client";

/**
 * Per-scheme holdings table for the investor-360 page — the full portfolio view.
 *
 * One row per scheme with: folio, start date, units, avg NAV, invested cost,
 * dividend, latest NAV + date, current value, unrealised gain, realised gain,
 * scheme weight %, avg holding days, absolute return %, and XIRR — plus a totals
 * row and per-row selection ("Show selected schemes").
 *
 * Data source:
 *   - units / latest NAV / current value / weight  → always available (from the
 *     RTA holdings import, even without transactions).
 *   - invested cost / avg NAV / unrealised gain / abs return / XIRR / start date /
 *     avg days / realised gain / dividend  → derived from the TRANSACTION history
 *     (valueInvestor). They render "—" until a transaction feed is imported, then
 *     populate automatically. Unpriced schemes (no live NAV) render dimmed.
 */

import { useMemo, useState } from "react";
import { Layers, AlertTriangle, ListFilter } from "lucide-react";

export type Holding = {
  schemeName: string | null;
  amcName: string | null;
  folioNumber: string | null;
  folioNumbers: string[];
  netUnits: number;
  investedNet: number;
  latestNav: number | null;
  navDate: string | null;
  currentValue: number | null;
  gain: number | null; // unrealised
  xirr: number | null; // decimal e.g. 0.14 = 14%
  kind: "sip" | "lumpsum" | "mixed" | null;
  priced: boolean;
  // ── Transaction-derived (optional — null until a transaction feed is imported) ──
  startDate?: string | null; // first purchase date
  avgDays?: number | null; // units-weighted holding period
  realisedGain?: number | null; // gain booked on redeemed units
  dividend?: number | null; // dividend payouts received
  hasTxns?: boolean; // true when this holding has transaction coverage
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtUnits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
function fmtNav(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/** Signed ₹ with colour (green up / red down). */
function Money({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-muted-foreground">—</span>;
  const up = v >= 0;
  return (
    <span className={`tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? "+" : "−"}₹{Math.round(Math.abs(v)).toLocaleString("en-IN")}
    </span>
  );
}
/** Signed % with colour. */
function Pct({ v, digits = 2 }: { v: number | null | undefined; digits?: number }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-muted-foreground">—</span>;
  const up = v >= 0;
  return <span className={`tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "+" : ""}{v.toFixed(digits)}</span>;
}

export function HoldingsTable({
  holdings,
  asOf,
  unpricedSchemes,
}: {
  holdings: Holding[];
  asOf: string | null;
  unpricedSchemes: number;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [onlySelected, setOnlySelected] = useState(false);

  const totalCurrent = useMemo(
    () => holdings.reduce((s, h) => s + (h.priced ? h.currentValue || 0 : 0), 0),
    [holdings]
  );

  // Derived per-row values (computable from what we already have).
  const rows = useMemo(
    () =>
      holdings.map((h, i) => {
        const avgNav = h.netUnits > 0 && h.investedNet > 0 ? h.investedNet / h.netUnits : null;
        const weight = totalCurrent > 0 && h.currentValue ? (h.currentValue / totalCurrent) * 100 : null;
        const absRet = h.investedNet > 0 && h.gain != null ? (h.gain / h.investedNet) * 100 : null;
        return { h, i, avgNav, weight, absRet };
      }),
    [holdings, totalCurrent]
  );

  const visibleRows = onlySelected ? rows.filter((r) => selected.has(r.i)) : rows;

  const toggle = (i: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.i))));

  // Totals (over the currently-visible rows; priced only for value/gain).
  const t = useMemo(() => {
    const src = visibleRows.map((r) => r.h);
    const priced = src.filter((h) => h.priced);
    const sum = (f: (h: Holding) => number | null | undefined) =>
      src.reduce((s, h) => s + (Number(f(h)) || 0), 0);
    const invested = sum((h) => h.investedNet);
    const current = priced.reduce((s, h) => s + (h.currentValue || 0), 0);
    const unrealised = priced.reduce((s, h) => s + (h.gain || 0), 0);
    const realised = sum((h) => h.realisedGain);
    const dividend = sum((h) => h.dividend);
    const units = sum((h) => h.netUnits);
    const absRet = invested > 0 ? (unrealised / invested) * 100 : null;
    return { invested, current, unrealised, realised, dividend, units, absRet };
  }, [visibleRows]);

  const th = "px-2.5 py-2 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap";
  const td = "px-2.5 py-2.5 align-top tabular-nums whitespace-nowrap";

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-sky-50 grid place-items-center">
            <Layers className="size-3.5 text-sky-700" />
          </div>
          Portfolio holdings
          <span className="text-xs font-normal text-muted-foreground">({holdings.length} schemes)</span>
        </h2>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setOnlySelected((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <ListFilter className="size-3.5" />
              {onlySelected ? "Show all" : `Show selected (${selected.size})`}
            </button>
          )}
          <div className="text-right">
            {asOf && <span className="text-xs text-muted-foreground">As of {fmtDate(asOf)}</span>}
            {unpricedSchemes > 0 && (
              <div className="text-[11px] text-amber-700 flex items-center justify-end gap-1 mt-0.5">
                <AlertTriangle className="size-3" />
                {unpricedSchemes} scheme{unpricedSchemes > 1 ? "s" : ""} not priced
              </div>
            )}
          </div>
        </div>
      </div>

      {holdings.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No holdings yet — they appear once an RTA folio/holdings file is imported.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-amber-50/70 text-amber-900 border-y border-amber-200">
                <th className={`${th} text-center`}>
                  <input
                    type="checkbox"
                    className="size-3.5 align-middle"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className={`${th} text-left`}>No</th>
                <th className={`${th} text-left`}>Folio</th>
                <th className={`${th} text-left`}>Scheme name</th>
                <th className={`${th} text-left`}>Start date</th>
                <th className={`${th} text-right`}>Units</th>
                <th className={`${th} text-right`}>Avg NAV</th>
                <th className={`${th} text-right`}>Inv. cost</th>
                <th className={`${th} text-right`}>Dividend</th>
                <th className={`${th} text-right`}>Latest NAV</th>
                <th className={`${th} text-left`}>NAV date</th>
                <th className={`${th} text-right`}>Curr value</th>
                <th className={`${th} text-right`}>Unrealised gain</th>
                <th className={`${th} text-right`}>Realised gain</th>
                <th className={`${th} text-right`}>Sch wgt %</th>
                <th className={`${th} text-right`}>Avg days</th>
                <th className={`${th} text-right`}>Abs ret %</th>
                <th className={`${th} text-right`}>XIRR %</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ h, i, avgNav, weight, absRet }, rowIdx) => (
                <tr
                  key={i}
                  className={`border-b last:border-0 hover:bg-secondary/30 ${h.priced ? "" : "opacity-60"} ${
                    rowIdx % 2 ? "bg-secondary/20" : ""
                  }`}
                >
                  <td className={`${td} text-center`}>
                    <input
                      type="checkbox"
                      className="size-3.5"
                      checked={selected.has(i)}
                      onChange={() => toggle(i)}
                      aria-label={`Select ${h.schemeName ?? "scheme"}`}
                    />
                  </td>
                  <td className={`${td} text-muted-foreground`}>{i + 1}</td>
                  <td className={`${td} text-left font-mono text-[11px] text-muted-foreground`}>
                    {(h.folioNumbers.length ? h.folioNumbers : h.folioNumber ? [h.folioNumber] : ["—"]).join(", ")}
                  </td>
                  <td className="px-2.5 py-2.5 align-top max-w-[240px]">
                    <div className="font-medium text-brand-cyan-deep truncate">{h.schemeName ?? "Unknown scheme"}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {h.amcName && <span className="text-[10px] text-muted-foreground truncate">{h.amcName}</span>}
                      {h.kind === "sip" && (
                        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-sky-50 text-sky-700">SIP</span>
                      )}
                    </div>
                  </td>
                  <td className={`${td} text-left text-muted-foreground`}>{fmtDate(h.startDate)}</td>
                  <td className={`${td} text-right`}>{fmtUnits(h.netUnits)}</td>
                  <td className={`${td} text-right`}>{fmtNav(avgNav)}</td>
                  <td className={`${td} text-right`}>{h.hasTxns ? fmtMoney(h.investedNet) : "—"}</td>
                  <td className={`${td} text-right`}>{h.dividend ? fmtMoney(h.dividend) : "—"}</td>
                  <td className={`${td} text-right`}>{fmtNav(h.latestNav)}</td>
                  <td className={`${td} text-left text-muted-foreground`}>{fmtDate(h.navDate)}</td>
                  <td className={`${td} text-right font-medium`}>{fmtMoney(h.currentValue)}</td>
                  <td className={`${td} text-right`}>{h.hasTxns ? <Money v={h.gain} /> : "—"}</td>
                  <td className={`${td} text-right`}>{h.realisedGain ? <Money v={h.realisedGain} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className={`${td} text-right`}>{fmtPct(weight)}</td>
                  <td className={`${td} text-right text-muted-foreground`}>
                    {h.avgDays != null ? Math.round(h.avgDays).toLocaleString("en-IN") : "—"}
                  </td>
                  <td className={`${td} text-right`}>{h.hasTxns ? <Pct v={absRet} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className={`${td} text-right`}>
                    {h.hasTxns && h.xirr != null ? <Pct v={h.xirr * 100} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-brand-cyan-deep text-white font-semibold">
                <td className="px-2.5 py-3" colSpan={4}>
                  Total{onlySelected ? ` (${visibleRows.length} selected)` : ""}
                </td>
                <td className="px-2.5 py-3" />
                <td className="px-2.5 py-3 text-right tabular-nums">{fmtUnits(t.units)}</td>
                <td className="px-2.5 py-3" />
                <td className="px-2.5 py-3 text-right tabular-nums">{t.invested ? fmtMoney(t.invested) : "—"}</td>
                <td className="px-2.5 py-3 text-right tabular-nums">{t.dividend ? fmtMoney(t.dividend) : "—"}</td>
                <td className="px-2.5 py-3" colSpan={2} />
                <td className="px-2.5 py-3 text-right tabular-nums">{fmtMoney(t.current)}</td>
                <td className="px-2.5 py-3 text-right tabular-nums">
                  {t.invested ? (t.unrealised >= 0 ? "+" : "−") + "₹" + Math.round(Math.abs(t.unrealised)).toLocaleString("en-IN") : "—"}
                </td>
                <td className="px-2.5 py-3 text-right tabular-nums">{t.realised ? "₹" + Math.round(t.realised).toLocaleString("en-IN") : "—"}</td>
                <td className="px-2.5 py-3 text-right tabular-nums">100.00</td>
                <td className="px-2.5 py-3" />
                <td className="px-2.5 py-3 text-right tabular-nums">{t.absRet != null ? (t.absRet >= 0 ? "+" : "") + t.absRet.toFixed(2) : "—"}</td>
                <td className="px-2.5 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Cost, gains, dividend, XIRR, start date &amp; avg days come from the <strong>transaction history</strong> (CAMS
        WBR2 / KFintech MFSD307). Columns show <span className="font-mono">—</span> until that feed is imported; units,
        NAV, current value &amp; weight come straight from the holdings file.
      </p>
    </div>
  );
}
