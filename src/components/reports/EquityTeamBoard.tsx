"use client";

/**
 * Equity Team MIS — Brokerage / New DMAT / Active Clients: Planned vs Actual-to-
 * date vs % vs this-month vs last-month vs MoM. Planned targets and this-month
 * brokerage are editable inline; New-DMAT / Active-Clients come from the DMAT
 * registry (manage under Direct Equity → DMAT accounts).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, Printer, ArrowUp, ArrowDown } from "lucide-react";
import Link from "next/link";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { EquityTeamReport, EquityMetricRow } from "@/lib/equity/service";

const money = (n: number) => "₹ " + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const intf = (n: number) => Math.round(n).toLocaleString("en-IN");
const val = (r: EquityMetricRow, n: number) => (r.isMoney ? money(n) : intf(n));

function defaultPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function recentMonths(count = 24) {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
function shortMon(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" }) + "'" + String(y % 100);
}
function fyFor(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const sy = m >= 4 ? y : y - 1;
  return `${sy}-${String((sy + 1) % 100).padStart(2, "0")}`;
}

export function EquityTeamBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const fy = fyFor(period);
  const [data, setData] = useState<EquityTeamReport | null>(null);
  const [planned, setPlanned] = useState<Record<string, string>>({});
  const [brokerage, setBrokerage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback((d: EquityTeamReport) => {
    setData(d);
    const p: Record<string, string> = {};
    for (const r of d.rows) p[r.key] = r.planned ? String(r.planned) : "";
    setPlanned(p);
    const brk = d.rows.find((r) => r.key === "brokerage");
    setBrokerage(brk && brk.thisMonth ? String(brk.thisMonth) : "");
  }, []);

  const load = useCallback(
    async (per: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/equity-team?fy=${fyFor(per)}&period=${per}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        hydrate(await res.json());
      } catch {
        toast.error("Could not load the Equity Team report.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [hydrate, toast]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

  const num = (s: string) => {
    const x = parseFloat(s);
    return Number.isFinite(x) ? x : 0;
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/equity/inputs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fiscalYear: fy,
          period,
          targets: {
            brokerage: num(planned.brokerage ?? ""),
            newDmat: num(planned.newDmat ?? ""),
            activeClients: num(planned.activeClients ?? ""),
          },
          brokerage: num(brokerage),
        }),
      });
      if (!res.ok) throw new Error();
      hydrate(await res.json());
      toast.success("Equity Team data saved.", "Saved");
    } catch {
      toast.error("Could not save.", "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const thisLbl = shortMon(period);
  const prevLbl = data ? shortMon(data.prevPeriod) : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">As of month</span>
          <SelectField className="w-44" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        </label>
        <Link href="/dashboard/equity" className="text-xs text-brand-cyan-deep hover:underline mb-2">
          Manage DMAT accounts →
        </Link>
        <div className="flex-1" />
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="size-4" /> Print
        </button>
        <button type="button" onClick={save} className="btn-primary" disabled={saving || loading}>
          <Save className="size-4" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {loading || !data ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide w-10 text-center">Sr.</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">Equity Team</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Planned ({fy})</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Actual upto {thisLbl}</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">% Achieved</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">{thisLbl}</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">{prevLbl}</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">MoM</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const plan = num(planned[r.key] ?? "");
                const thisMonth = r.key === "brokerage" ? num(brokerage) : r.thisMonth;
                const ach = plan > 0 ? (r.actualToDate / plan) * 100 : null;
                const mom = r.lastMonth !== 0 ? ((thisMonth - r.lastMonth) / r.lastMonth) * 100 : null;
                const up = thisMonth - r.lastMonth >= 0;
                return (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-3 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium">{r.label}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min="0"
                        value={planned[r.key] ?? ""}
                        onChange={(e) => setPlanned((s) => ({ ...s, [r.key]: e.target.value }))}
                        className="w-28 text-right tabular-nums bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{val(r, r.actualToDate)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${ach != null && ach >= 100 ? "text-emerald-600" : ach != null && ach >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                      {ach != null ? `${ach.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {r.key === "brokerage" ? (
                        <input
                          type="number"
                          min="0"
                          value={brokerage}
                          onChange={(e) => setBrokerage(e.target.value)}
                          className="w-28 text-right tabular-nums bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="0"
                        />
                      ) : (
                        val(r, thisMonth)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{val(r, r.lastMonth)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
                      {mom != null ? (
                        <span className="inline-flex items-center justify-end gap-0.5">
                          {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                          {Math.abs(mom).toFixed(0)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Enter the FY Planned per metric and this month's Brokerage; New DMAT &amp; Active Clients compute from the
        DMAT registry. “Actual upto” is FY-to-date. Brokerage is one figure per month.
      </p>
    </div>
  );
}
